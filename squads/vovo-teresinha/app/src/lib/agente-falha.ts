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
  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      statusCode: 400,
      message: "Payload inválido ou vazio",
    };
  }

  const webhookPayload = payload as WebhookMercadoPagoPayload;

  if (!webhookPayload.type || !webhookPayload.data?.id) {
    return {
      valid: false,
      statusCode: 400,
      message: "Campos obrigatórios ausentes",
    };
  }

  return {
    valid: true,
    statusCode: 200,
    message: "Validação bem-sucedida",
  };
}

export async function limparBacklogFalhas(): Promise<void> {
  try {
    const timeoutId = setTimeout(() => {
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

      clearTimeout(timeoutId);

      if (Array.isArray(falhasAntiga) && falhasAntiga.length > 0) {
        const ids = falhasAntiga.map((f) => f.id);
        await sql`
          DELETE FROM falhas_agentes
          WHERE id = ANY(${ids})
        `;

        await enviarTelegram(
          `🧹 <b>Limpeza de Backlog Executada</b>\n` +
          `Registros removidos: ${ids.length}\n` +
          `Retenção: ${TEMPO_RETENCAO_FALHAS}h`
        );
      }

      const totalAbertoResult = (await Promise.race([
        sql`
          SELECT COUNT(*) as total FROM falhas_agentes
          WHERE resolvido = FALSE
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as FalhaResult[];

      clearTimeout(timeoutId);

      const totalAberto = totalAbertoResult[0]?.total || 0;

      if (totalAberto > LIMITE_BACKLOG) {
        const excesso = totalAberto - LIMITE_BACKLOG;
        await enviarTelegram(
          `⚠️ <b>Backlog de Falhas Elevado</b>\n` +
          `Total aberto: ${totalAberto}\n` +
          `Limite: ${LIMITE_BACKLOG}\n` +
          `Excesso: ${excesso}`
        );
      }
    } catch (error) {
      clearTimeout(timeoutId);
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `Erro: ${errorMessage}`
      );
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[limparBacklogFalhas] Erro crítico:", errorMessage);
    throw error;
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const timeoutId = setTimeout(() => {
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

      clearTimeout(timeoutId);

      await enviarTelegram(
        `🔴 <b>Falha Registrada</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}`
      );
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[registrarFalha] Erro ao registrar falha:", errorMessage);
    throw error;
  }
}

export async function resolverFalhas(ids: number[]): Promise<void> {
  if (!Array.isArray(ids) || ids.length === 0) {
    throw new Error("Lista de IDs inválida ou vazia");
  }

  try {
    const timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      await Promise.race([
        sql`
          UPDATE falhas_agentes
          SET resolvido = TRUE
          WHERE id = ANY(${ids})
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      clearTimeout(timeoutId);

      await enviarTelegram(
        `✅ <b>Falhas Resolvidas</b>\n` +
        `Total: ${ids.length}`
      );
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[resolverFalhas] Erro ao resolver falhas:", errorMessage);
    throw error;
  }
}

export async function obterFalhasAbertas(): Promise<FalhaRegistro[]> {
  try {
    const timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const falhas = (await Promise.race([
        sql<FalhaRegistro>`
          SELECT id, agente, erro, resolvido, criado_em
          FROM falhas_agentes
          WHERE resolvido = FALSE
          ORDER BY criado_em DESC
          LIMIT 100
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ])) as FalhaRegistro[];

      clearTimeout(timeoutId);

      return falhas;
    } catch (error) {
      clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[obterFalhasAbertas] Erro ao obter falhas:", errorMessage);
    throw error;
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelAtual: "especialista" | "gerente" | "claude"
): Promise<boolean> {
  try {
    const falhas = await obterFalhasAbertas();
    const falha = falhas.find((f) => f.id === falhaId);

    if (!falha) {
      console.error("[escalarFalha] Falha não encontrada");
      return false;
    }

    let responsavel: string | null = null;

    if (nivelAtual === "especialista") {
      responsavel = await getGerenteResponsavel(falha.agente);
    } else if (nivelAtual === "gerente") {
      responsavel = await getEspecialistaResponsavel("claude");
    }

    if (responsavel) {
      await enviarTelegram(
        `📈 <b>Falha Escalada</b>\n` +
        `De: ${nivelAtual}\n` +
        `Para: ${responsavel}\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}`
      );
      return true;
    }

    return false;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("[escalarFalha] Erro ao escalar falha:", errorMessage);
    throw error;
  }
}

export async function validarWebhook(
  payload: WebhookValidacaoPayload
): Promise<{ valido: boolean; statusCode: number }> {
  const { agente, erro, statusCode: receivedStatusCode } = payload;

  if (!agente || !erro) {
    return {
      valido: false,
      statusCode: 400,
    };
  }

  const statusCode = receivedStatusCode || 500;

  if (statusCode >= 500) {
    await registrarFalha(agente, erro, payload);
  }

  return {
    valido: true,
    statusCode: 200,
  };
}