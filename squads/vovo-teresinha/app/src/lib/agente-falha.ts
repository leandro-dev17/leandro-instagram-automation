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
    const falhasAntigas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntigas.length > 0) {
      const ids = falhasAntigas.map((f) => f.id);
      await sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${ids}::int[])
      `;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
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

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function escalarFalha(
  falhaId: number,
  novoNivel: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falha.length === 0) {
      throw new Error(`Falha com ID ${falhaId} não encontrada`);
    }

    const { agente, erro } = falha[0];

    let destinatarios: string[] = [];

    if (novoNivel === "especialista") {
      destinatarios = [await getEspecialistaResponsavel(agente)];
    } else if (novoNivel === "gerente") {
      destinatarios = [await getGerenteResponsavel(agente)];
    } else if (novoNivel === "claude") {
      destinatarios = ["claude_team"];
    }

    await enviarTelegram(
      `⚠️ <b>Falha Escalada para ${novoNivel.toUpperCase()}</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n`,
      destinatarios
    );
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function gerarRelatorioFalhas(): Promise<{
  total: number;
  porAgente: Record<string, number>;
  taxa: string;
}> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const falhasPorAgente = await Promise.race<Array<{ agente: string; total: number }>>([
      sql<Array<{ agente: string; total: number }>>`
        SELECT agente, COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        GROUP BY agente
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = resultado[0]?.total || 0;
    const porAgente: Record<string, number> = {};
    falhasPorAgente.forEach((item) => {
      porAgente[item.agente] = item.total;
    });

    const taxa = totalFalhas > 0 ? ((totalFalhas / 1000) * 100).toFixed(2) : "0.00";

    return {
      total: totalFalhas,
      porAgente,
      taxa: `${taxa}%`,
    };
  } catch (error) {
    console.error("Erro ao gerar relatório de falhas:", error);
    return { total: 0, porAgente: {}, taxa: "0.00%" };
  }
}

export async function processarWebhookValidacao(
  payload: WebhookValidacaoPayload
): Promise<{ status: number; mensagem: string }> {
  try {
    const { agente, erro, dados, statusCode } = payload;

    if (!agente || !erro) {
      return {
        status: 400,
        mensagem: "Agente e erro são campos obrigatórios",
      };
    }

    await registrarFalha(agente, erro, dados);

    const falhasAgente = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE agente = ${agente} AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = falhasAgente[0]?.total || 0;

    if (totalFalhas >= LIMITE_ESPECIALISTA) {
      await escalarFalha(totalFalhas, "especialista");
    }

    if (totalFalhas >= LIMITE_GERENTE) {
      await escalarFalha(totalFalhas, "gerente");
    }

    if (totalFalhas >= LIMITE_CLAUDE) {
      await escalarFalha(totalFalhas, "claude");
    }

    return {
      status: 202,
      mensagem: "Webhook processado com sucesso",
    };
  } catch (error) {
    console.error("Erro ao processar webhook de validação:", error);
    return {
      status: 500,
      mensagem: "Erro ao processar webhook",
    };
  }
}

export async function verificarSaudeMercadoPago(): Promise<{
  status: string;
  timestamp: string;
  ultimaVerificacao: string;
}> {
  try {
    const verificacao = await Promise.race([
      fetch(`${APP_URL}/api/webhooks