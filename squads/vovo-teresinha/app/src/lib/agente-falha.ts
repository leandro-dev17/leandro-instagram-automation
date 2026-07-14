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
      sql`
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
      await sql`DELETE FROM falhas_agentes WHERE id = ANY(${ids})`;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function analisarFalhasRecentes(): Promise<Map<string, number>> {
  const mapa = new Map<string, number>();

  try {
    const resultado = await Promise.race<Array<{ agente: string; total: string | number }>>(
      [
        sql`
          SELECT agente, COUNT(*) as total
          FROM falhas_agentes
          WHERE criado_em > NOW() - INTERVAL '2 hours'
          GROUP BY agente
          ORDER BY total DESC
        `,
        new Promise<Array<{ agente: string; total: string | number }>>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]
    );

    for (const row of resultado) {
      const total = typeof row.total === "string" ? parseInt(row.total, 10) : row.total;
      mapa.set(row.agente, total);
    }

    return mapa;
  } catch (error) {
    console.error("Erro ao analisar falhas recentes:", error);
    return mapa;
  }
}

export async function escalarFalha(
  agente: string,
  erro: string,
  nivel: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const mensagem =
      nivel === "especialista"
        ? `⚠️ <b>Escalação para Especialista</b>\nAgente: ${agente}\nErro: ${erro}`
        : nivel === "gerente"
          ? `⚠️ <b>Escalação para Gerente</b>\nAgente: ${agente}\nErro: ${erro}`
          : `⚠️ <b>Escalação para Claude AI</b>\nAgente: ${agente}\nErro: ${erro}`;

    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(agente);

    const destinatarios =
      nivel === "especialista" ? [especialista] : nivel === "gerente" ? [gerente] : [gerente, especialista];

    await enviarTelegram(mensagem, destinatarios);

    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, criado_em = NOW()
      WHERE agente = ${agente}
      LIMIT 1
    `;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function verificarEscalacoes(): Promise<void> {
  try {
    const falhas = await analisarFalhasRecentes();

    for (const [agente, total] of falhas) {
      if (total >= LIMITE_ESPECIALISTA && total < LIMITE_GERENTE) {
        await escalarFalha(agente, `${total} falhas nos últimos 2 horas`, "especialista");
      } else if (total >= LIMITE_GERENTE && total < LIMITE_CLAUDE) {
        await escalarFalha(agente, `${total} falhas nos últimos 2 horas`, "gerente");
      } else if (total >= LIMITE_CLAUDE) {
        await escalarFalha(agente, `${total} falhas nos últimos 2 horas`, "claude");
      }
    }
  } catch (error) {
    console.error("Erro ao verificar escalações:", error);
  }
}

export async function processarWebhookValidacao(
  payload: WebhookValidacaoPayload
): Promise<{ statusCode: number; message: string }> {
  try {
    if (!payload.agente || !payload.erro) {
      return {
        statusCode: 400,
        message: "Campos obrigatórios ausentes",
      };
    }

    await registrarFalha(payload.agente, payload.erro, payload.dados);

    return {
      statusCode: 200,
      message: "Falha registrada com sucesso",
    };
  } catch (error) {
    return {
      statusCode: 500,
      message: `Erro ao processar webhook: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
  }
}

export async function executarCronVerificacao(secret: string): Promise<{ success: boolean; message: string }> {
  try {
    if (secret !== CRON_SECRET) {
      return {
        success: false,
        message: "Secret inválido",
      };
    }

    await verificarEscalacoes();
    await limparBacklogFalhas();

    return {
      success: true,
      message: "Verificação executada com sucesso",
    };
  } catch (error) {
    return {
      success: false,
      message: `Erro na execução do cron: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
  }
}