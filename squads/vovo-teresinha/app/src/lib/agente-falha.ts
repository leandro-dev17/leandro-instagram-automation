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
        `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
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
    await sql`
      INSERT INTO falhas_agentes (agente, erro, status_code, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${statusCode || 500}, FALSE, NOW())
    `;

    const totalFalhas = await sql<FalhaResult[]>`
      SELECT COUNT(*)::int as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    if (
      Array.isArray(totalFalhas) &&
      totalFalhas.length > 0 &&
      totalFalhas[0].total > LIMITE_BACKLOG
    ) {
      await enviarTelegram(
        `⚠️ <b>Backlog de Falhas Elevado</b>\n` +
        `Agente: ${agente}\n` +
        `Total: ${totalFalhas[0].total} falhas não resolvidas\n`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
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

export async function resolverFalha(falhaId: number, resolucao: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolução: ${resolucao}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function notificarEscalacao(
  falha: FalhaRegistro,
  nivel: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    let responsavel = "";

    if (nivel === "especialista") {
      responsavel = await getEspecialistaResponsavel(falha.agente);
    } else if (nivel === "gerente") {
      responsavel = await getGerenteResponsavel(falha.agente);
    } else {
      responsavel = "Claude (IA)";
    }

    const mensagem =
      `🚨 <b>Escalação de Falha - Nível ${nivel.toUpperCase()}</b>\n` +
      `Responsável: ${responsavel}\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `ID: ${falha.id}\n` +
      `Criado: ${falha.criado_em}\n`;

    await enviarTelegram(mensagem);
  } catch (error) {
    console.error("Erro ao notificar escalação:", error);
  }
}

export async function processarFalhasComEscalacao(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const horasCriacao = Math.floor(
        (new Date().getTime() - new Date(falha.criado_em).getTime()) / (1000 * 60 * 60)
      );

      if (horasCriacao >= 4) {
        await notificarEscalacao(falha, "claude");
      } else if (horasCriacao >= 2) {
        await notificarEscalacao(falha, "gerente");
      } else if (horasCriacao >= 1) {
        await notificarEscalacao(falha, "especialista");
      }
    }
  } catch (error) {
    console.error("Erro ao processar falhas com escalação:", error);
  }
}

export async function gerarRelatorioFalhas(): Promise<{
  total: number;
  por_agente: Record<string, number>;
  taxa_resolucao: number;
}> {
  try {
    const totalFalhas = await sql<FalhaResult[]>`
      SELECT COUNT(*)::int as total FROM falhas_agentes
    `;

    const falhasPorAgente = await sql<Array<{ agente: string; total: number }>>`
      SELECT agente, COUNT(*)::int as total
      FROM falhas_agentes
      GROUP BY agente
      ORDER BY total DESC
    `;

    const falhasResolvidas = await sql<FalhaResult[]>`
      SELECT COUNT(*)::int as total FROM falhas_agentes
      WHERE resolvido = TRUE
    `;

    const total = Array.isArray(totalFalhas) && totalFalhas.length > 0 ? totalFalhas[0].total : 0;
    const resolvidas = Array.isArray(falhasResolvidas) && falhasResolvidas.length > 0 ? falhasResolvidas[0].total : 0;
    const taxaResolucao = total > 0 ? (resolvidas / total) * 100 : 0;

    const porAgente: Record<string, number> = {};
    if (Array.isArray(falhasPorAgente)) {
      falhasPorAgente.forEach((item) => {
        porAgente[item.agente] = item.total;
      });
    }

    return {
      total,
      por_agente: porAgente,
      taxa_resolucao: Math.round(taxaResolucao * 100) / 100,
    };
  } catch (error) {
    console.error("Erro ao gerar relatório:", error);
    return { total: 0, por_agente: {}, taxa_resolucao: 0 };
  }
}