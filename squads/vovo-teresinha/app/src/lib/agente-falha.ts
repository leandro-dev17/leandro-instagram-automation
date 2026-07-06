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
      console.error("Erro ao limpar backlog de falhas:", error);
      throw error;
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<{ id: number }> {
  try {
    const resultado = await Promise.race<Array<{ id: number }>>([
      sql<Array<{ id: number }>>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE)
        RETURNING id
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(resultado) && resultado.length > 0) {
      const { id } = resultado[0];

      const countResult = await Promise.race<Array<FalhaResult>>([
        sql<Array<FalhaResult>>`
          SELECT COUNT(*) as total FROM falhas_agentes
          WHERE agente = ${agente} AND resolvido = FALSE
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      const totalFalhas = Array.isArray(countResult) ? countResult[0]?.total || 0 : 0;

      if (totalFalhas >= LIMITE_ESPECIALISTA) {
        const especialista = await getEspecialistaResponsavel(agente);
        if (especialista) {
          await enviarTelegram(
            `🚨 <b>Falha Crítica Detectada</b>\n` +
            `Agente: ${agente}\n` +
            `Especialista: ${especialista}\n` +
            `Total de falhas: ${totalFalhas}\n` +
            `Erro: ${erro}`
          );
        }
      }

      if (totalFalhas >= LIMITE_GERENTE) {
        const gerente = await getGerenteResponsavel(agente);
        if (gerente) {
          await enviarTelegram(
            `🔴 <b>Escalação para Gerente</b>\n` +
            `Agente: ${agente}\n` +
            `Gerente: ${gerente}\n` +
            `Total de falhas: ${totalFalhas}`
          );
        }
      }

      return { id };
    }

    throw new Error("Falha ao inserir registro de falha");
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      throw new Error("Timeout ao registrar falha no banco de dados");
    }
    throw error;
  }
}

export async function resolverFalha(
  id: number,
  solucao: string
): Promise<void> {
  try {
    await Promise.race<void>([
      (async () => {
        await sql`
          UPDATE falhas_agentes
          SET resolvido = TRUE, solucao = ${solucao}, resolvido_em = NOW()
          WHERE id = ${id}
        `;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      throw new Error("Timeout ao resolver falha no banco de dados");
    }
    throw error;
  }
}

export async function listarFalhasNaoResolvidas(): Promise<Array<FalhaRegistro>> {
  try {
    const falhas = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
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

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error("Timeout ao listar falhas não resolvidas");
      return [];
    }
    throw error;
  }
}

export async function executarAgenteFalha(): Promise<void> {
  try {
    if (!CRON_SECRET) {
      throw new Error("CRON_SECRET não configurado");
    }

    const falhasNaoResolvidas = await listarFalhasNaoResolvidas();

    for (const falha of falhasNaoResolvidas) {
      try {
        const response = await Promise.race<Response>([
          fetch(`${APP_URL}/api/falhas/processar`, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "x-cron-secret": CRON_SECRET,
            },
            body: JSON.stringify({
              falhaId: falha.id,
              agente: falha.agente,
              erro: falha.erro,
            }),
          }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
          ),
        ]);

        if (!response.ok) {
          console.error(`Erro ao processar falha ${falha.id}:`, response.statusText);
        }
      } catch (error) {
        if (error instanceof Error && error.message === "HTTP_TIMEOUT") {
          console.error(`Timeout ao processar falha ${falha.id}`);
        } else {
          console.error(`Erro ao processar falha ${falha.id}:`, error);
        }
      }
    }

    await limparBacklogFalhas();
  } catch (error) {
    console.error("Erro ao executar agente de falha:", error);
    await enviarTelegram(
      `❌ <b>Erro no Agente de Falha</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
    throw error;
  }
}