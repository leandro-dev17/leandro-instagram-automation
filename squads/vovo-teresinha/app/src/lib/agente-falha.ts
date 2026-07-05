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

export async function registrarFalha(
  agente: string,
  erro: string,
  statusCode?: number
): Promise<void> {
  try {
    const resultado = await Promise.race<FalhaResult>([
      sql<Array<FalhaResult>>`
        INSERT INTO falhas_agentes (agente, erro, status_code, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${statusCode || 500}, FALSE, NOW())
        RETURNING id
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(resultado) && resultado.length > 0) {
      await enviarTelegram(
        `⚠️ <b>Falha Registrada</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Status: ${statusCode || 500}\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`[${agente}] Timeout ao registrar falha`);
    } else {
      console.error(`[${agente}] Erro ao registrar falha:`, error);
    }
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

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Obter Falhas</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro ao Obter Falhas</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
      );
    }
    return [];
  }
}

export async function resolverFalha(falhaId: number): Promise<boolean> {
  try {
    const resultado = await Promise.race<Array<{ id: number }>>([
      sql<Array<{ id: number }>>`
        UPDATE falhas_agentes
        SET resolvido = TRUE, atualizado_em = NOW()
        WHERE id = ${falhaId}
        RETURNING id
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(resultado) && resultado.length > 0;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Resolver Falha</b>\n` +
        `ID: ${falhaId}\n`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro ao Resolver Falha</b>\n` +
        `ID: ${falhaId}\n` +
        `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
      );
    }
    return false;
  }
}

export async function notificarResponsaveis(
  falha: FalhaRegistro,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    let responsavel: string | null = null;

    if (nivelEscalacao === "especialista") {
      responsavel = await getEspecialistaResponsavel(falha.agente);
    } else if (nivelEscalacao === "gerente") {
      responsavel = await getGerenteResponsavel(falha.agente);
    } else if (nivelEscalacao === "claude") {
      responsavel = "@claude";
    }

    if (responsavel) {
      await enviarTelegram(
        `🚨 <b>Escalação de Falha</b>\n` +
        `Responsável: ${responsavel}\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Nível: ${nivelEscalacao}\n`
      );
    }
  } catch (error) {
    console.error("Erro ao notificar responsáveis:", error);
  }
}

export async function processarFalhasComEscalacao(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const horasCriacao = Math.floor(
        (Date.now() - new Date(falha.criado_em).getTime()) / (1000 * 60 * 60)
      );

      if (horasCriacao >= LIMITE_CLAUDE) {
        await notificarResponsaveis(falha, "claude");
      } else if (horasCriacao >= LIMITE_GERENTE) {
        await notificarResponsaveis(falha, "gerente");
      } else if (horasCriacao >= LIMITE_ESPECIALISTA) {
        await notificarResponsaveis(falha, "especialista");
      }
    }

    await limparBacklogFalhas();
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao Processar Falhas com Escalação</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
    );
  }
}

export async function validarWebhookMercadoPago(req: {
  method: string;
  body: unknown;
}): Promise<{ statusCode: number; body: Record<string, unknown> }> {
  if (req.method !== "POST") {
    await registrarFalha(
      "webhook_mp_valida_assinatura",
      `Método HTTP inválido: ${req.method}`,
      405
    );
    return {
      statusCode: 405,
      body: { error: "Método não permitido" },
    };
  }

  const validacao = await validarAssinaturaMercadoPago(req.body);

  if (!validacao.valid) {
    await registrarFalha(
      "webhook_mp_valida_assinatura",
      validacao.message,
      validacao.statusCode
    );
  }

  return {
    statusCode: validacao.statusCode,
    body: { message: validacao.message },
  };
}