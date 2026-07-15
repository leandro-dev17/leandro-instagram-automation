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
      statusCode: 400,
      message: `Erro na validação: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
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

    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(agente);

    await enviarTelegram(
      `🚨 <b>Falha Detectada</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n` +
      `Especialista: ${especialista}\n` +
      `Gerente: ${gerente}\n`,
      [especialista, gerente]
    );
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function limparBacklogFalhas(): Promise<void> {
  try {
    const falhasAntigas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        AND resolvido = FALSE
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<FalhaRegistro[]>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntigas.length === 0) {
      return;
    }

    const ids = falhasAntigas.map((f) => f.id);
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ANY(${ids})
    `;

    await enviarTelegram(
      `✅ <b>Limpeza de Backlog</b>\n` +
      `Falhas resolvidas: ${ids.length}\n` +
      `Timestamp: ${new Date().toISOString()}\n`,
      []
    );
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function acompanharFalhaComEscalacao(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const contagem = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      `,
      new Promise<FalhaResult[]>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = contagem[0]?.total || 0;

    await registrarFalha(agente, erro, dados);

    if (totalFalhas >= LIMITE_ESPECIALISTA && totalFalhas < LIMITE_GERENTE) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `⚠️ <b>Escalação para Especialista</b>\n` +
        `Agente: ${agente}\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `Especialista: ${especialista}\n`,
        [especialista]
      );
    } else if (totalFalhas >= LIMITE_GERENTE && totalFalhas < LIMITE_CLAUDE) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🔴 <b>Escalação para Gerente</b>\n` +
        `Agente: ${agente}\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `Gerente: ${gerente}\n`,
        [gerente]
      );
    } else if (totalFalhas >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `💥 <b>Escalação Crítica - Claude AI</b>\n` +
        `Agente: ${agente}\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `Status: CRÍTICO\n`,
        []
      );
    }
  } catch (error) {
    console.error("Erro ao acompanhar falha com escalação:", error);
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
      `Resolução: ${resolucao}\n`,
      []
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
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
      new Promise<FalhaRegistro[]>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}