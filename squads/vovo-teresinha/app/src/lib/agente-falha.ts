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
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      throw error;
    }
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Erro desconhecido";
    console.error(`[limparBacklogFalhas] Erro:`, mensagem);
    await enviarTelegram(
      `⚠️ <b>Erro na Limpeza de Backlog</b>\n` +
      `Erro: ${mensagem}\n` +
      `Timestamp: ${new Date().toISOString()}`
    );
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    await verificarLimitesFalhas();
  } catch (error) {
    console.error(`[registrarFalhaAgente] Erro ao registrar falha:`, error);
  }
}

export async function verificarLimitesFalhas(): Promise<void> {
  try {
    const falhas = (await sql`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE resolvido = FALSE
      AND criado_em > NOW() - INTERVAL '1 hour'
      GROUP BY agente
      ORDER BY total DESC
    `) as Array<{ agente: string; total: number }>;

    for (const falha of falhas) {
      let responsavel = "";
      let limite = 0;

      if (falha.total >= LIMITE_CLAUDE) {
        responsavel = "Claude (Escalação máxima)";
        limite = LIMITE_CLAUDE;
      } else if (falha.total >= LIMITE_GERENTE) {
        responsavel = await getGerenteResponsavel(falha.agente);
        limite = LIMITE_GERENTE;
      } else if (falha.total >= LIMITE_ESPECIALISTA) {
        responsavel = await getEspecialistaResponsavel(falha.agente);
        limite = LIMITE_ESPECIALISTA;
      }

      if (responsavel) {
        await notificarFalha(falha.agente, falha.total, limite, responsavel);
      }
    }
  } catch (error) {
    console.error(`[verificarLimitesFalhas] Erro:`, error);
  }
}

export async function notificarFalha(
  agente: string,
  total: number,
  limite: number,
  responsavel: string
): Promise<void> {
  try {
    const mensagem = `
🚨 <b>Falha no Agente: ${agente}</b>
Ocorrências: ${total}/${limite}
Responsável: ${responsavel}
Timestamp: ${new Date().toISOString()}
`;

    await enviarTelegram(mensagem);

    await sql`
      UPDATE falhas_agentes
      SET notificado = TRUE
      WHERE agente = ${agente}
      AND notificado = FALSE
      AND criado_em > NOW() - INTERVAL '1 hour'
    `;
  } catch (error) {
    console.error(`[notificarFalha] Erro:`, error);
  }
}

export async function resolverFalhasAgente(agente: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE agente = ${agente}
      AND resolvido = FALSE
    `;

    await enviarTelegram(
      `✅ <b>Falhas Resolvidas</b>\n` +
      `Agente: ${agente}\n` +
      `Timestamp: ${new Date().toISOString()}`
    );
  } catch (error) {
    console.error(`[resolverFalhasAgente] Erro:`, error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    return (await sql`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      AND criado_em > NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
      ORDER BY criado_em DESC
      LIMIT 100
    `) as FalhaRegistro[];
  } catch (error) {
    console.error(`[obterFalhasNaoResolvidas] Erro:`, error);
    return [];
  }
}

export async function analisarFalhasRecentes(): Promise<{
  totalFalhas: number;
  agentesComFalha: string[];
  taxaErro: number;
}> {
  try {
    const resultado = (await sql`
      SELECT
        COUNT(*) as total,
        COUNT(DISTINCT agente) as agentes_unicos
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
      AND resolvido = FALSE
    `) as Array<{ total: number; agentes_unicos: number }>;

    const agentes = (await sql`
      SELECT DISTINCT agente
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
      AND resolvido = FALSE
    `) as Array<{ agente: string }>;

    const totalFalhas = resultado[0]?.total || 0;
    const agentesComFalha = agentes.map((a) => a.agente);
    const taxaErro = totalFalhas > 0 ? (totalFalhas / 100) * 100 : 0;

    return {
      totalFalhas,
      agentesComFalha,
      taxaErro,
    };
  } catch (error) {
    console.error(`[analisarFalhasRecentes] Erro:`, error);
    return {
      totalFalhas: 0,
      agentesComFalha: [],
      taxaErro: 0,
    };
  }
}

export async function triggerAgenteFalha(): Promise<void> {
  const { totalFalhas, agentesComFalha, taxaErro } =
    await analisarFalhasRecentes();

  if (totalFalhas >= LIMITE_BACKLOG) {
    await enviarTelegram(
      `🔴 <b>CRÍTICO: Taxa de Erros Elevada</b>\n` +
      `Total de Falhas: ${totalFalhas}\n` +
      `Taxa de Erro: ${taxaErro.toFixed(2)}%\n` +
      `Agentes Afetados: ${agentesComFalha.join(", ")}\n` +
      `Timestamp: ${new Date().toISOString()}`
    );
  }

  await limparBacklogFalhas();
}