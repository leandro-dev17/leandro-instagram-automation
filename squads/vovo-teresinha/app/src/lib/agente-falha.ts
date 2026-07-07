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
      throw error;
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const backlogAtual = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    const total = backlogAtual[0]?.total ?? 0;

    if (total >= LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Backlog de Falhas Crítico</b>\n` +
        `Registros abertos: ${total}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
      return;
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false)
    `;
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    throw error;
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await sql<FalhaRegistro[]>`
      SELECT * FROM falhas_agentes WHERE id = ${falhaId}
    `;

    if (!falha || falha.length === 0) {
      throw new Error("Falha não encontrada");
    }

    const responsavel =
      nivelEscalacao === "especialista"
        ? await getEspecialistaResponsavel()
        : nivelEscalacao === "gerente"
          ? await getGerenteResponsavel()
          : "claude-3-7-sonnet";

    const mensagem =
      `🚨 <b>Escalação de Falha - ${nivelEscalacao.toUpperCase()}</b>\n` +
      `ID: ${falhaId}\n` +
      `Agente: ${falha[0].agente}\n` +
      `Erro: ${falha[0].erro}\n` +
      `Responsável: ${responsavel}\n`;

    await enviarTelegram(mensagem);

    await sql`
      UPDATE falhas_agentes
      SET resolvido = FALSE
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
    throw error;
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    throw error;
  }
}

export async function obterFalhasAbertos(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT * FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT ${LIMITE_BACKLOG}
    `;

    return falhas || [];
  } catch (error) {
    console.error("Erro ao obter falhas abertos:", error);
    return [];
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  total: number;
  abertos: number;
  resolvidos: number;
}> {
  try {
    const stats = await sql<
      Array<{ total: number; resolvido: boolean }>
    >`
      SELECT COUNT(*) as total, resolvido
      FROM falhas_agentes
      GROUP BY resolvido
    `;

    const abertos = stats.find((s) => s.resolvido === false)?.total ?? 0;
    const resolvidos = stats.find((s) => s.resolvido === true)?.total ?? 0;

    return {
      total: abertos + resolvidos,
      abertos,
      resolvidos,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas:", error);
    return {
      total: 0,
      abertos: 0,
      resolvidos: 0,
    };
  }
}