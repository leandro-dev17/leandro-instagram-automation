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
      console.error("Erro ao limpar backlog:", error);
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}`
      );
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido)
      VALUES (${agente}, ${erro}, ${dados ? JSON.stringify(dados) : null}, false)
    `;

    const resultado = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    const total = resultado[0]?.total || 0;

    if (total > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Limite de Backlog Excedido</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas não resolvidas: ${total}\n` +
        `Limite: ${LIMITE_BACKLOG}`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Registrar Falha</b>\n` +
      `Agente: ${agente}\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }
}

export async function escalacionarFalha(
  falhaId: number,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await sql<FalhaRegistro[]>`
      SELECT * FROM falhas_agentes WHERE id = ${falhaId}
    `;

    if (!falha || falha.length === 0) {
      console.error(`Falha ${falhaId} não encontrada`);
      return;
    }

    const registro = falha[0];

    let responsavel: string | null = null;
    let mensagem = "";

    if (nivelEscalacao === "especialista") {
      responsavel = await getEspecialistaResponsavel(registro.agente);
      mensagem = `🔴 <b>Escalação para Especialista</b>\n`;
    } else if (nivelEscalacao === "gerente") {
      responsavel = await getGerenteResponsavel();
      mensagem = `🔴 <b>Escalação para Gerente</b>\n`;
    } else if (nivelEscalacao === "claude") {
      responsavel = "claude-api";
      mensagem = `🔴 <b>Escalação para Claude</b>\n`;
    }

    await sql`
      UPDATE falhas_agentes
      SET escalado_para = ${responsavel}, escalado_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      mensagem +
      `Falha ID: ${falhaId}\n` +
      `Agente: ${registro.agente}\n` +
      `Responsável: ${responsavel}\n` +
      `Erro: ${registro.erro}`
    );
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Escalar Falha</b>\n` +
      `Falha ID: ${falhaId}\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }
}

export async function analisarTaxaErros(): Promise<void> {
  try {
    const resultado = await sql<Array<{ total: number; percentual: number }>>`
      SELECT
        COUNT(*) as total,
        ROUND(COUNT(*) * 100.0 / NULLIF(
          (SELECT COUNT(*) FROM eventos_webhook WHERE criado_em > NOW() - INTERVAL '2 hours'), 0
        ), 2) as percentual
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
    `;

    const stats = resultado[0];

    if (!stats) {
      console.error("Erro ao obter estatísticas");
      return;
    }

    if (stats.percentual > 30) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Crítica</b>\n` +
        `Últimas 2h: ${stats.percentual}%\n` +
        `Total de falhas: ${stats.total}\n` +
        `⚠️ Ação imediata necessária!`
      );

      const falhasCriticas = await sql<FalhaRegistro[]>`
        SELECT * FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        AND resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 5
      `;

      for (const falha of falhasCriticas) {
        if (falha.agente.includes("webhook_mp")) {
          await escalacionarFalha(falha.id, "especialista");
        }
      }
    }
  } catch (error) {
    console.error("Erro ao analisar taxa de erros:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Analisar Taxa de Erros</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }
}

export async function resolverFalha(
  falhaId: number,
  solucao: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, solucao = ${solucao}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `Falha ID: ${falhaId}\n` +
      `Solução: ${solucao}`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Resolver Falha</b>\n` +
      `Falha ID: ${falhaId}\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }
}

export async function listarFalhasNaoResolvidas(
  limite: number = 20
): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT * FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT ${limite}
    `;

    return falhas;
  } catch (error) {
    console.error("Erro ao listar falhas não resolvidas:", error);
    return [];
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalNaoResolvidas: number;
  totalResolvidas: number;
  percentualErrosUltimas2h: number;
}> {
  try {
    const nao