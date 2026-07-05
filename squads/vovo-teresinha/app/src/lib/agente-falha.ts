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
        sql<Array<{ id: number }>>`
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
          `Registros removidos: ${ids.length}\n`
        );
      }
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      await enviarTelegram(
        `⚠️ <b>Erro na Limpeza de Backlog</b>\n` +
        `Erro: ${dbError instanceof Error ? dbError.message : "Desconhecido"}\n`
      );
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    console.error("[limparBacklogFalhas] Erro geral:", error);
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const backlogCount = (await sql<Array<{ total: number }>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `) as Array<{ total: number }>;

    const totalAberto = backlogCount[0]?.total ?? 0;

    if (totalAberto >= LIMITE_BACKLOG) {
      await limparBacklogFalhas();
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados)}, FALSE, NOW())
    `;
  } catch (error) {
    console.error("[registrarFalha] Erro:", error);
  }
}

export async function resolverFalha(id: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${id}
    `;
  } catch (error) {
    console.error("[resolverFalha] Erro:", error);
  }
}

export async function obterFalhasAbertos(): Promise<FalhaRegistro[]> {
  try {
    const falhas = (await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 50
    `) as FalhaRegistro[];

    return falhas;
  } catch (error) {
    console.error("[obterFalhasAbertos] Erro:", error);
    return [];
  }
}

export async function analisarFalhasComAgente(falhas: FalhaRegistro[]): Promise<void> {
  if (falhas.length === 0) return;

  try {
    const resumoFalhas = falhas
      .map((f) => `[${f.agente}] ${f.erro}`)
      .join("\n");

    await enviarTelegram(
      `🔍 <b>Análise de Falhas Detectadas</b>\n` +
      `Total: ${falhas.length}\n\n` +
      `${resumoFalhas.substring(0, 500)}`
    );
  } catch (error) {
    console.error("[analisarFalhasComAgente] Erro:", error);
  }
}

export async function processoAgenteFalhasScheduled(): Promise<void> {
  try {
    const falhas = await obterFalhasAbertos();

    if (falhas.length > 0) {
      await analisarFalhasComAgente(falhas);
    }

    if (falhas.length >= LIMITE_BACKLOG / 2) {
      await limparBacklogFalhas();
    }
  } catch (error) {
    console.error("[processoAgenteFalhasScheduled] Erro:", error);
    await enviarTelegram(
      `❌ <b>Erro no Processo de Falhas</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
  }
}