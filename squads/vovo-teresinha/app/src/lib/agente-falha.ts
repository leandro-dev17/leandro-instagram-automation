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
      const falhasAntiga = await Promise.race([
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
      throw dbError;
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    await enviarTelegram(
      `❌ <b>Erro ao limpar backlog de falhas</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
    throw error;
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${dados ? JSON.stringify(dados) : null}, false, NOW())
    `;

    await verificarLimiareFalhas(agente);
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    await enviarTelegram(
      `⚠️ <b>Erro ao registrar falha no banco</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
  }
}

export async function verificarLimiareFalhas(agente: string): Promise<void> {
  try {
    const resultado = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente = ${agente}
      AND resolvido = FALSE
      AND criado_em > NOW() - INTERVAL '1 hour'
    `;

    const total = resultado[0]?.total || 0;

    if (total >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `🚨 <b>Limite de Falhas Atingido</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas: ${total}/${LIMITE_ESPECIALISTA}\n` +
        `Especialista: ${especialista || "Não atribuído"}`
      );
    }

    if (total >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🔴 <b>Escalação para Gerente</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas Críticas: ${total}/${LIMITE_GERENTE}\n` +
        `Gerente: ${gerente || "Não atribuído"}`
      );
    }

    if (total >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `💀 <b>Falha Crítica - Escalação Máxima</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas Críticas: ${total}/${LIMITE_CLAUDE}\n` +
        `Ação: Revisar imediatamente ou desabilitar agente`
      );
    }
  } catch (error) {
    console.error("Erro ao verificar limiares de falhas:", error);
  }
}

export async function resolverFalha(id: number, resolucao: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}, atualizado_em = NOW()
      WHERE id = ${id}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${id}\n` +
      `Resolução: ${resolucao}`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    throw error;
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      AND criado_em > NOW() - INTERVAL '24 hours'
      ORDER BY criado_em DESC
      LIMIT ${LIMITE_BACKLOG}
    `;

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function executarRotinaManutenção(): Promise<void> {
  if (!CRON_SECRET || process.env.CRON_SECRET_HEADER !== CRON_SECRET) {
    throw new Error("CRON_SECRET inválido ou não configurado");
  }

  try {
    await limparBacklogFalhas();
    
    const falhas = await obterFalhasNaoResolvidas();
    
    if (falhas.length > 0) {
      await enviarTelegram(
        `📋 <b>Relatório de Falhas Pendentes</b>\n` +
        `Total: ${falhas.length}\n` +
        `URL: ${APP_URL}/admin/falhas`
      );
    }
  } catch (error) {
    console.error("Erro na rotina de manutenção:", error);
    await enviarTelegram(
      `❌ <b>Falha na Rotina de Manutenção</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
    throw error;
  }
}