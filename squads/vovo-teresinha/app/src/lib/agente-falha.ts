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
        `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
      );
    }
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error(`Erro ao registrar falha do agente ${agente}:`, error);
  }
}

export async function escalarFalhaParaGerente(
  falhaId: number,
  agente: string,
  erro: string
): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel(agente);

    if (gerente) {
      await enviarTelegram(
        `🚨 <b>Escalação para Gerente</b>\n` +
        `Agente: ${agente}\n` +
        `Gerente: ${gerente}\n` +
        `Erro: ${erro}\n`
      );

      await sql`
        UPDATE falhas_agentes
        SET escalado_para = ${gerente}, escalado_em = NOW()
        WHERE id = ${falhaId}
      `;
    }
  } catch (error) {
    console.error(`Erro ao escalar falha ${falhaId}:`, error);
  }
}

export async function escalarFalhaParaEspecialista(
  falhaId: number,
  agente: string,
  erro: string
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);

    if (especialista) {
      await enviarTelegram(
        `🔧 <b>Escalação para Especialista</b>\n` +
        `Agente: ${agente}\n` +
        `Especialista: ${especialista}\n` +
        `Erro: ${erro}\n`
      );

      await sql`
        UPDATE falhas_agentes
        SET escalado_para = ${especialista}, escalado_em = NOW()
        WHERE id = ${falhaId}
      `;
    }
  } catch (error) {
    console.error(`Erro ao escalar falha para especialista ${falhaId}:`, error);
  }
}

export async function analisarFalhasRecentes(): Promise<void> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        AND resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 50
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = falhas.length;
    const taxaErro = (totalFalhas / LIMITE_BACKLOG) * 100;

    if (taxaErro > 30) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Elevada Detectada</b>\n` +
        `Taxa: ${taxaErro.toFixed(2)}%\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `Período: Últimas 2 horas\n`
      );

      for (const falha of falhas.slice(0, LIMITE_ESPECIALISTA)) {
        await escalarFalhaParaEspecialista(falha.id, falha.agente, falha.erro);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout na Análise de Falhas</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      console.error("Erro ao analisar falhas recentes:", error);
    }
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolvido_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error(`Erro ao resolver falha ${falhaId}:`, error);
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalNaoResolvidas: number;
  totalResolvidas24h: number;
  agentesComMaisFalhas: Array<{ agente: string; count: number }>;
}> {
  try {
    const naoResolvidas = await Promise.race<Array<{ total: number }>>([
      sql<Array<{ total: number }>>`
        SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const resolvidas24h = await Promise.race<Array<{ total: number }>>([
      sql<Array<{ total: number }>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = TRUE AND resolvido_em > NOW() - INTERVAL '24 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const agentesComMaisFalhas = await Promise.race<
      Array<{ agente: string; count: number }>
    >([
      sql<Array<{ agente: string; count: number }>>`
        SELECT agente, COUNT(*) as count FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '24 hours'
        GROUP BY agente
        ORDER BY count DESC
        LIMIT 10
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return {
      totalNaoResolvidas: naoResolvidas[0]?.total || 0,
      totalResolvidas24h: resolvidas24h[0]?.total || 0,
      agentesComMaisFalhas: agentesComMaisFalhas || [],
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas:", error);
    return {
      totalNaoResolvidas: 0,
      totalResolvidas24h: 0,
      agentesComMaisFalhas: [],
    };
  }
}

export async function