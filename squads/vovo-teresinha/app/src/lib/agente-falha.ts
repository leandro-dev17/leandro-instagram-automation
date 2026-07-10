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

export async function registrarFalhaAgente(
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

    const contagem = await Promise.race<Array<{ count: number }>>([
      sql<Array<{ count: number }>>`
        SELECT COUNT(*) as count FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = contagem[0]?.count || 0;

    if (totalFalhas >= LIMITE_ESPECIALISTA && totalFalhas < LIMITE_GERENTE) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `⚠️ <b>Falha Detectada - Nível Especialista</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Responsável: ${especialista}\n` +
        `Total de falhas: ${totalFalhas}`
      );
    } else if (totalFalhas >= LIMITE_GERENTE && totalFalhas < LIMITE_CLAUDE) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🔴 <b>Falha Detectada - Nível Gerência</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Responsável: ${gerente}\n` +
        `Total de falhas: ${totalFalhas}`
      );
    } else if (totalFalhas >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🚨 <b>Falha Crítica - Escalonamento Claude</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `⚡ Acionando suporte crítico`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
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
      `Resolução: ${resolucao}`
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
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas:", error);
    return [];
  }
}

export async function verificarSaudeAgentes(): Promise<void> {
  try {
    const falhasNaoResolvidas = await obterFalhasNaoResolvidas();
    const totalFalhas = falhasNaoResolvidas.length;

    if (totalFalhas > LIMITE_BACKLOG * 0.8) {
      await enviarTelegram(
        `⚠️ <b>Alerta de Saúde dos Agentes</b>\n` +
        `Falhas não resolvidas: ${totalFalhas}/${LIMITE_BACKLOG}\n` +
        `Taxa de ocupação: ${Math.round((totalFalhas / LIMITE_BACKLOG) * 100)}%`
      );
    }
  } catch (error) {
    console.error("Erro ao verificar saúde dos agentes:", error);
  }
}

export async function validarWebhookMercadoPago(
  payload: unknown
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  if (!payload) {
    return {
      valid: false,
      statusCode: 400,
      message: "Webhook payload é obrigatório",
    };
  }

  return validarAssinaturaMercadoPago(payload);
}