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

export async function registrarFalha(
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

    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(agente);

    await enviarTelegram(
      `🚨 <b>Falha Detectada</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n` +
      `Especialista: ${especialista}\n` +
      `Gerente: ${gerente}\n`,
      [especialista, gerente]
    );
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function limparBacklogFalhas(): Promise<void> {
  try {
    const falhasAntiga = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<FalhaRegistro[]>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length > 0) {
      const ids = falhasAntiga.map((f) => f.id);
      await sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${ids})
      `;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function resolverFalha(id: number): Promise<void> {
  try {
    await Promise.race([
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
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalFalhas: number;
  falhasNaoResolvidas: number;
  agentesComFalhas: string[];
}> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<FalhaResult[]>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = resultado[0]?.total || 0;

    const agentesComFalhas = await Promise.race<Array<{ agente: string }>>([
      sql<{ agente: string }>`
        SELECT DISTINCT agente
        FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<Array<{ agente: string }>>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return {
      totalFalhas,
      falhasNaoResolvidas: totalFalhas,
      agentesComFalhas: agentesComFalhas.map((r) => r.agente),
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      totalFalhas: 0,
      falhasNaoResolvidas: 0,
      agentesComFalhas: [],
    };
  }
}

export async function escalarFalha(
  id: number,
  agente: string,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${id}
      `,
      new Promise<FalhaRegistro[]>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falha.length === 0) {
      throw new Error(`Falha com ID ${id} não encontrada`);
    }

    let destinatario = "";
    if (nivelEscalacao === "especialista") {
      destinatario = await getEspecialistaResponsavel(agente);
    } else if (nivelEscalacao === "gerente") {
      destinatario = await getGerenteResponsavel(agente);
    } else if (nivelEscalacao === "claude") {
      destinatario = "claude-api";
    }

    await enviarTelegram(
      `⚠️ <b>Falha Escalada</b>\n` +
      `ID: ${id}\n` +
      `Agente: ${agente}\n` +
      `Erro: ${falha[0].erro}\n` +
      `Nível: ${nivelEscalacao}\n` +
      `Destinatário: ${destinatario}\n`,
      [destinatario]
    );

    await sql`
      UPDATE falhas_agentes
      SET escalado = TRUE, nivel_escalacao = ${nivelEscalacao}
      WHERE id = ${id}
    `;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function verificarSaudeFalhas(): Promise<boolean> {
  try {
    const stats = await obterEstatisticasFalhas();
    const percentualFalhas = stats.totalFalhas > 0 ? (stats.falhasNaoResolvidas / stats.totalFalhas) * 100 : 0;

    if (percentualFalhas > 30) {
      await enviarTelegram(
        `🔴 <b>Taxa de Erros Crítica</b>\n` +
        `Percentual: ${percentualFalhas.toFixed(2)}%\n` +
        `Total de falhas: ${stats.totalFalhas}\n` +
        `Agentes afetados: ${stats.agentesComFalhas.join(", ")}\n`,
        ["gerente-geral"]
      );
      return false;
    }

    return true;
  } catch (error) {
    console.error("Erro ao verificar saúde das falhas:", error);
    return false;
  }
}