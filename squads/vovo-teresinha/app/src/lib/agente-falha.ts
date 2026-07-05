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
      if (dbError instanceof Error && dbError.message === "DB_TIMEOUT") {
        await enviarTelegram(
          `⚠️ <b>Timeout na Limpeza de Backlog</b>\n` +
          `Banco de dados não respondeu em ${DB_TIMEOUT}ms\n`
        );
      } else {
        throw dbError;
      }
    }
  } catch (error) {
    if (timeoutId) clearTimeout(timeoutId);
    await enviarTelegram(
      `❌ <b>Erro ao Limpar Backlog</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
    );
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

    const contagem = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente = ${agente} AND resolvido = FALSE
    `;

    if (contagem.length > 0 && contagem[0].total >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `⚠️ <b>Falha Registrada</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Especialista: ${especialista || "N/A"}\n`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT ${LIMITE_BACKLOG}
    `;

    return falhas || [];
  } catch (error) {
    console.error("Erro ao obter falhas:", error);
    return [];
  }
}

export async function analisarFalhasRecentes(): Promise<{
  totalFalhas: number;
  falhasPorAgente: Record<string, number>;
  agentesComProblemas: string[];
}> {
  try {
    const falhas = await sql<Array<{ agente: string; total: number }>>`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE resolvido = FALSE
      AND criado_em > NOW() - INTERVAL '2 hours'
      GROUP BY agente
      ORDER BY total DESC
    `;

    const falhasPorAgente: Record<string, number> = {};
    let totalFalhas = 0;
    const agentesComProblemas: string[] = [];

    for (const registro of falhas || []) {
      falhasPorAgente[registro.agente] = registro.total;
      totalFalhas += registro.total;

      if (registro.total >= LIMITE_ESPECIALISTA) {
        agentesComProblemas.push(registro.agente);
      }
    }

    if (agentesComProblemas.length > 0) {
      const gerente = await getGerenteResponsavel(agentesComProblemas[0]);
      await enviarTelegram(
        `🚨 <b>Análise de Falhas - Últimas 2 Horas</b>\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `Agentes com problemas: ${agentesComProblemas.join(", ")}\n` +
        `Gerente responsável: ${gerente || "N/A"}\n`
      );
    }

    return {
      totalFalhas,
      falhasPorAgente,
      agentesComProblemas,
    };
  } catch (error) {
    console.error("Erro ao analisar falhas:", error);
    return {
      totalFalhas: 0,
      falhasPorAgente: {},
      agentesComProblemas: [],
    };
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE id = ${falhaId}
    `;

    if (!falha || falha.length === 0) {
      return;
    }

    const registro = falha[0];
    let responsavel = "";

    if (nivelEscalacao === "especialista") {
      responsavel = await getEspecialistaResponsavel(registro.agente);
    } else if (nivelEscalacao === "gerente") {
      responsavel = await getGerenteResponsavel(registro.agente);
    } else {
      responsavel = "Claude (IA)";
    }

    await enviarTelegram(
      `🔄 <b>Falha Escalada</b>\n` +
      `ID: ${falhaId}\n` +
      `Agente: ${registro.agente}\n` +
      `Erro: ${registro.erro}\n` +
      `Escalado para: ${responsavel}\n` +
      `Nível: ${nivelEscalacao}\n`
    );
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}