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
      throw error;
    }
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
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
    } else {
      throw error;
    }
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
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Obter Falhas Não Resolvidas</b>\n` +
        `Será retentado na próxima execução.\n`
      );
      return [];
    }
    throw error;
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
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Resolver Falha</b>\n` +
        `ID da Falha: ${falhaId}\n`
      );
    } else {
      throw error;
    }
  }
}

export async function notificarEscalacao(
  falha: FalhaRegistro,
  nivel: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    let responsavel: { nome: string; telefone: string } | null = null;

    if (nivel === "especialista") {
      responsavel = await getEspecialistaResponsavel(falha.agente);
    } else if (nivel === "gerente") {
      responsavel = await getGerenteResponsavel(falha.agente);
    }

    if (responsavel) {
      await enviarTelegram(
        `🚨 <b>Escalação de Falha - ${nivel.toUpperCase()}</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Responsável: ${responsavel.nome}\n` +
        `Contato: ${responsavel.telefone}\n` +
        `Data: ${new Date(falha.criado_em).toLocaleString("pt-BR")}\n`
      );
    } else if (nivel === "claude") {
      await enviarTelegram(
        `🔴 <b>Falha Crítica - Intervenção Manual Necessária</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Data: ${new Date(falha.criado_em).toLocaleString("pt-BR")}\n` +
        `Status: Escalado para análise manual\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Notificar Escalação</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      throw error;
    }
  }
}

export async function processarFalhasComEscalacao(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const contarTentativas = await Promise.race<FalhaResult>([
        sql<FalhaResult[]>`
          SELECT COUNT(*) as total
          FROM falhas_agentes
          WHERE agente = ${falha.agente}
          AND resolvido = FALSE
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]).then((result) => {
        const arr = result as FalhaResult[];
        return arr[0] || { total: 0 };
      });

      const tentativas = contarTentativas.total;

      if (tentativas >= LIMITE_CLAUDE) {
        await notificarEscalacao(falha, "claude");
      } else if (tentativas >= LIMITE_GERENTE) {
        await notificarEscalacao(falha, "gerente");
      } else if (tentativas >= LIMITE_ESPECIALISTA) {
        await notificarEscalacao(falha, "especialista");
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message !== "DB_TIMEOUT") {
      throw error;
    }
  }
}

export async function executarAgenteComFalha<T>(
  agente: string,
  funcao: () => Promise<T>,
  tentativaMaxima: number = 3
): Promise<T> {
  let ultimoErro: Error | null = null;

  for (let tentativa = 1; tentativa <= tentativaMaxima; tentativa++) {
    try {
      return await funcao();
    } catch (error) {
      ultimoErro = error instanceof Error ? error : new Error(String(error));

      if (tentativa === tentativaMaxima) {
        await registrarFalha(agente, ultimoErro.message, {
          tentativa,
          agente,
          erro: ultimoErro.message,
        });

        await enviarTelegram(
          `❌ <b>Falha em Agente</b>\n` +
          `Agente: ${agente}\n` +
          `Tentativas: ${tentativa}\n` +
          `Erro: ${ultimoErro.message}\n`
        );

        throw ultimoErro;
      }

      const delayMs = Math.min(1000 * Math.pow(2, tentativa - 1), 10000);
      await new Promise((resolve) => setTimeout(resolve, delayMs));