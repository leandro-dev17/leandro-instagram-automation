```typescript
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { getGerenteResponsavel, getEspecialistaResponsavel } from "@/lib/hierarquia";

const LIMITE_ESPECIALISTA = 3;
const LIMITE_GERENTE = 4;
const LIMITE_CLAUDE = 5;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;
const DB_TIMEOUT = 5000;
const HTTP_TIMEOUT = 55000;
const LIMITE_BACKLOG = 100;
const TEMPO_RETENCAO_FALHAS = 24;

interface FalhaResult {
  total: number;
}

interface WebhookValidacaoPayload {
  agente: string;
  erro: string;
  dados?: Record<string, unknown>;
  statusCode?: number;
}

interface WebhookMercadoPagoPayload {
  type?: string;
  data?: {
    id?: string;
  };
}

interface FalhaRegistro {
  id: number;
  agente: string;
  erro: string;
  resolvido: boolean;
  criado_em: string;
}

export async function validarAssinaturaMercadoPago(
  payload: unknown
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  try {
    if (payload === null || payload === undefined) {
      return {
        valid: false,
        statusCode: 400,
        message: "Payload inválido ou vazio",
      };
    }

    if (typeof payload !== "object") {
      return {
        valid: false,
        statusCode: 400,
        message: "Payload deve ser um objeto",
      };
    }

    const webhookPayload = payload as WebhookMercadoPagoPayload;

    if (!webhookPayload.type || !webhookPayload.data?.id) {
      return {
        valid: false,
        statusCode: 400,
        message: "Campos obrigatórios ausentes: type ou data.id",
      };
    }

    return {
      valid: true,
      statusCode: 200,
      message: "Validação bem-sucedida",
    };
  } catch (error) {
    return {
      valid: false,
      statusCode: 500,
      message: `Erro na validação: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
  }
}

export async function limparBacklogFalhas(): Promise<void> {
  try {
    const falhasAntiga = await Promise.race<Array<{ id: number }>>([
      sql<Array<{ id: number }>>`
        SELECT id FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        AND resolvido = TRUE
        LIMIT 1000
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(falhasAntiga) && falhasAntiga.length > 0) {
      const ids = falhasAntiga.map((f) => f.id);
      await sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${ids})
      `;

      await enviarTelegram(
        `🧹 <b>Limpeza de Backlog Executada</b>\n` +
        `Registros removidos: ${ids.length}\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout na Limpeza de Backlog</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}`
      );
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `❌ <b>Falha Registrada</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n` +
      `Timestamp: ${new Date().toISOString()}\n`
    );
  } catch (error) {
    console.error(`Erro ao registrar falha para ${agente}:`, error);
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalFalhas: number;
  falhasNaoResolvidas: number;
  agentesComFalha: string[];
}> {
  try {
    const resultado = await Promise.race([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '24 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = Array.isArray(resultado) && resultado.length > 0 ? resultado[0].total : 0;

    const naoResolvidas = await Promise.race([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const falhasNaoResolvidas = Array.isArray(naoResolvidas) && naoResolvidas.length > 0 ? naoResolvidas[0].total : 0;

    const agentes = await Promise.race([
      sql<Array<{ agente: string }>>`
        SELECT DISTINCT agente FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '24 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const agentesComFalha = Array.isArray(agentes) ? agentes.map((a) => a.agente) : [];

    return {
      totalFalhas: typeof totalFalhas === 'number' ? totalFalhas : 0,
      falhasNaoResolvidas: typeof falhasNaoResolvidas === 'number' ? falhasNaoResolvidas : 0,
      agentesComFalha,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      totalFalhas: 0,
      falhasNaoResolvidas: 0,
      agentesComFalha: [],
    };
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolução: ${resolucao}\n`
    );
  } catch (error) {
    console.error(`Erro ao resolver falha ${falhaId}:`, error);
  }
}

export async function escalarFalha(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const falha = await Promise.race([
      sql<FalhaRegistro[]>`
        SELECT * FROM falhas_agentes WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(falha) || falha.length === 0) {
      throw new Error(`Falha ${falhaId} não encontrada`);
    }

    const falhaRegistro = falha[0];
    const tentativas = (falhaRegistro.criado_em ? 1 : 0) + LIMITE_ESPECIALISTA;

    if (tentativas > LIMITE_ESPECIALISTA) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🚨 <b>Escalação para Gerente</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${agente}\n` +
        `Gerente: ${gerente || "Não atribuído"}\n`
      );
    } else {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `⚠️ <b>Escalação para Especialista</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${agente}\n` +
        `Especialista: ${especialista || "Não atribuído"}\n`
      );
    }
  } catch (error) {
    console.error(`Erro ao escalar falha ${falhaId}:`, error);
  }
}

export async function verificarSaudeAgentes(): Promise<{
  status: string;
  agentesComErro: string[];
  taxaErro: number;
}> {
  try {
    const estatisticas = await obterEstatisticasFalhas();
    const LIMITE_TAXA_ERRO = 0.3;
    const taxaErro = estatisticas.totalFalhas > 0 ? estatisticas.falhasNaoResolvidas / estatisticas.totalFalhas : 0;

    const status = taxaErro > LIMITE_TAXA_ERRO ? "CRITICO" : "NORMAL";

    if (status === "CRITICO") {
      await enviarTelegram(
        `🚨 <b>Status Crítico Detectado</b>\n` +
        `Taxa de Erro: ${(taxaErro * 100).toFixed(2)}%\n` +
        `Agentes afetados: ${estatisticas.agentesComFalha.join(", ")}\n`
      );
    }

    return {
      status,
      agentesComErro: estatisticas.agentesComFalha,
      taxaErro,
    };
  } catch