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
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const falhasAntiga = (await Promise.race([
        sql`
          SELECT id FROM falhas_agentes
          WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
          AND resolvido = TRUE
          LIMIT 1000
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as Array<{ id: number }>;

      if (timeoutId) clearTimeout(timeoutId);

      if (Array.isArray(falhasAntiga) && falhasAntiga.length > 0) {
        const ids = falhasAntiga.map((f) => f.id);
        await sql`
          DELETE FROM falhas_agentes
          WHERE id = ANY(${ids})
        `;

        await enviarTelegram(
          `🧹 <b>Limpeza de Backlog Executada</b>\n` +
          `Registros removidos: ${ids.length}\n` +
          `Timestamp: ${new Date().toISOString()}`
        );
      }
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error("Erro ao limpar backlog:", error);
    await enviarTelegram(
      `❌ <b>Erro na Limpeza de Backlog</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n` +
      `Timestamp: ${new Date().toISOString()}`
    );
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

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

      if (timeoutId) clearTimeout(timeoutId);

      const contagem = (await sql`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
      `) as Array<FalhaResult>;

      const totalFalhas = contagem[0]?.total || 0;

      if (totalFalhas >= LIMITE_ESPECIALISTA) {
        const especialista = await getEspecialistaResponsavel(agente);
        await enviarTelegram(
          `⚠️ <b>Falha Detectada - Especialista</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${totalFalhas}\n` +
          `Responsável: ${especialista}\n` +
          `Erro: ${erro}`
        );
      }

      if (totalFalhas >= LIMITE_GERENTE) {
        const gerente = await getGerenteResponsavel(agente);
        await enviarTelegram(
          `🔴 <b>Falha Detectada - Gerente</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${totalFalhas}\n` +
          `Responsável: ${gerente}\n` +
          `Erro: ${erro}`
        );
      }

      if (totalFalhas >= LIMITE_CLAUDE) {
        await enviarTelegram(
          `🚨 <b>Falha Crítica - Claude</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${totalFalhas}\n` +
          `Erro: ${erro}\n` +
          `URL: ${APP_URL}/dashboard/falhas`
        );
      }
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalha(
  id: number,
  solucao: string
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const falha = (await Promise.race([
        sql`
          SELECT agente FROM falhas_agentes WHERE id = ${id}
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as Array<{ agente: string }>;

      if (timeoutId) clearTimeout(timeoutId);

      if (falha.length === 0) {
        throw new Error("Falha não encontrada");
      }

      await sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, solucao = ${solucao}
        WHERE id = ${id}
      `;

      await enviarTelegram(
        `✅ <b>Falha Resolvida</b>\n` +
        `Agente: ${falha[0].agente}\n` +
        `Solução: ${solucao}`
      );
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error("Erro ao resolver falha:", error);
    throw error;
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const falhas = (await Promise.race([
        sql`
          SELECT id, agente, erro, resolvido, criado_em
          FROM falhas_agentes
          WHERE resolvido = FALSE
          ORDER BY criado_em DESC
          LIMIT ${LIMITE_BACKLOG}
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as FalhaRegistro[];

      if (timeoutId) clearTimeout(timeoutId);

      return falhas;
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function handleWebhookValidacao(
  payload: WebhookValidacaoPayload
): Promise<{ statusCode: number; message: string }> {
  try {
    if (!payload.agente || !payload.erro) {
      return {
        statusCode: 400,
        message: "Campos obrigatórios ausentes",
      };
    }

    await registrarFalha(payload.agente, payload.erro, payload.dados);

    return {
      statusCode: 200,
      message: "Falha registrada com sucesso",
    };
  } catch (error) {
    return {
      statusCode: 500,
      message: `Erro ao processar webhook: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
  }
}