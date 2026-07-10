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
      console.error("Erro ao limpar backlog:", error);
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
    const totalFalhas = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
        RETURNING (SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE) as total
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(totalFalhas) && totalFalhas.length > 0 ? totalFalhas[0].total : 0;

    if (total > LIMITE_BACKLOG) {
      await escalarFalhaParaGerente(agente, erro, dados);
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Registrar Falha</b>\n` +
      `Agente: ${agente}\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }
}

export async function escalarFalhaParaEspecialista(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);

    const message = `⚠️ <b>Escalação para Especialista</b>\n` +
      `Agente: ${agente}\n` +
      `Especialista: ${especialista.nome}\n` +
      `Erro: ${erro}\n` +
      `Dados: ${JSON.stringify(dados || {})}`;

    await enviarTelegram(message);

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;
  } catch (error) {
    console.error("Erro ao escalar para especialista:", error);
    throw error;
  }
}

export async function escalarFalhaParaGerente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel(agente);

    const message = `🔴 <b>Escalação para Gerente</b>\n` +
      `Agente: ${agente}\n` +
      `Gerente: ${gerente.nome}\n` +
      `Erro: ${erro}\n` +
      `Dados: ${JSON.stringify(dados || {})}`;

    await enviarTelegram(message);

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;
  } catch (error) {
    console.error("Erro ao escalar para gerente:", error);
    throw error;
  }
}

export async function resolverFalha(
  falhaId: number,
  solucao: string
): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, solucao = ${solucao}, resolvido_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Solução: ${solucao}`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    throw error;
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 50
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function verificarSaudeAgente(nomeAgente: string): Promise<{
  saudavel: boolean;
  taxaErro: number;
  ultimoErro?: string;
}> {
  try {
    const resultado = await Promise.race<Array<{
      total: number;
      nao_resolvidos: number;
      ultimo_erro?: string;
    }>>([
      sql<Array<{
        total: number;
        nao_resolvidos: number;
        ultimo_erro?: string;
      }>>`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN resolvido = FALSE THEN 1 END) as nao_resolvidos,
          MAX(erro) as ultimo_erro
        FROM falhas_agentes
        WHERE agente = ${nomeAgente}
        AND criado_em > NOW() - INTERVAL '1 hour'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(resultado) || resultado.length === 0) {
      return {
        saudavel: true,
        taxaErro: 0,
      };
    }

    const { total, nao_resolvidos, ultimo_erro } = resultado[0];
    const taxaErro = total > 0 ? (nao_resolvidos / total) * 100 : 0;

    return {
      saudavel: taxaErro < 10,
      taxaErro,
      ultimoErro: ultimo_erro,
    };
  } catch (error) {
    console.error("Erro ao verificar saúde do agente:", error);
    return {
      saudavel: false,
      taxaErro: 100,
    };
  }
}

export async function notificarFalhaWebhook(
  payload: WebhookValidacaoPayload
): Promise<void> {
  try {
    await registrarFalha(
      payload.agente,
      payload.erro,
      payload.dados
    );

    if (payload.statusCode && payload.statusCode