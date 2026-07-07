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

export async function registrarFalha(payload: WebhookValidacaoPayload): Promise<FalhaRegistro> {
  try {
    const [falha] = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
        INSERT INTO falhas_agentes (agente, erro, resolvido, criado_em)
        VALUES (${payload.agente}, ${payload.erro}, false, NOW())
        RETURNING id, agente, erro, resolvido, criado_em
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const backlogCount = await contarFalhasAberto();
    if (backlogCount > LIMITE_BACKLOG) {
      await notificarBacklogExcessivo(backlogCount);
    }

    return falha;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      throw new Error("Timeout ao registrar falha");
    }
    throw error;
  }
}

export async function contarFalhasAberto(): Promise<number> {
  try {
    const [result] = await Promise.race<Array<FalhaResult>>([
      sql<Array<FalhaResult>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return result.total;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Contar Falhas</b>\n` +
        `Não foi possível verificar o backlog.\n`
      );
      return 0;
    }
    throw error;
  }
}

export async function notificarBacklogExcessivo(total: number): Promise<void> {
  try {
    const escalacao = total > LIMITE_CLAUDE 
      ? "Claude"
      : total > LIMITE_GERENTE
      ? getGerenteResponsavel()
      : getEspecialistaResponsavel();

    await enviarTelegram(
      `🚨 <b>Backlog de Falhas Excessivo</b>\n` +
      `Total: ${total} registros abertos\n` +
      `Escalado para: ${escalacao}\n`
    );
  } catch (error) {
    console.error("Erro ao notificar backlog excessivo:", error);
  }
}

export async function resolverFalha(id: number): Promise<void> {
  try {
    await Promise.race<void>([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE
        WHERE id = ${id}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      throw new Error("Timeout ao resolver falha");
    }
    throw error;
  }
}

export async function obterFalhasAbertas(): Promise<Array<FalhaRegistro>> {
  try {
    const falhas = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
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

    return falhas;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Obter Falhas</b>\n` +
        `Não foi possível listar falhas abertas.\n`
      );
      return [];
    }
    throw error;
  }
}

export async function processarFalhaWebhook(payload: unknown): Promise<{ valid: boolean; statusCode: number; message: string }> {
  try {
    if (!payload || typeof payload !== "object") {
      return {
        valid: false,
        statusCode: 400,
        message: "Payload inválido",
      };
    }

    const validacao = await validarAssinaturaMercadoPago(payload);

    if (!validacao.valid) {
      await registrarFalha({
        agente: "webhook_mp_valida_assinatura",
        erro: validacao.message,
        dados: payload as Record<string, unknown>,
        statusCode: validacao.statusCode,
      });
    }

    return validacao;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    await registrarFalha({
      agente: "webhook_mp_processa",
      erro: errorMessage,
    });

    return {
      valid: false,
      statusCode: 500,
      message: errorMessage,
    };
  }
}