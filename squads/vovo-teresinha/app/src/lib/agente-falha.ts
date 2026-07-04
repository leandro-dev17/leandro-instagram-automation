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
          `Registros removidos: ${ids.length}\n`
        );
      }
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
    await enviarTelegram(
      `❌ <b>Erro na Limpeza de Backlog</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
    );
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<FalhaRegistro | null> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const resultado = await Promise.race([
        sql<FalhaRegistro[]>`
          INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
          VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
          RETURNING id, agente, erro, resolvido, criado_em
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      return Array.isArray(resultado) && resultado.length > 0 ? resultado[0] : null;
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    console.error("Erro ao registrar falha do agente:", error);
    return null;
  }
}

export async function obterFalhasNaoResolvidas(
  filtroAgente?: string
): Promise<FalhaRegistro[]> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const query = filtroAgente
        ? sql<FalhaRegistro[]>`
            SELECT id, agente, erro, resolvido, criado_em
            FROM falhas_agentes
            WHERE resolvido = FALSE
            AND agente = ${filtroAgente}
            ORDER BY criado_em DESC
            LIMIT ${LIMITE_BACKLOG}
          `
        : sql<FalhaRegistro[]>`
            SELECT id, agente, erro, resolvido, criado_em
            FROM falhas_agentes
            WHERE resolvido = FALSE
            ORDER BY criado_em DESC
            LIMIT ${LIMITE_BACKLOG}
          `;

      const resultado = await Promise.race([
        query,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      return Array.isArray(resultado) ? resultado : [];
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function marcarFalhaResolvida(
  idFalha: number,
  respostaEspecialista?: string
): Promise<boolean> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      await Promise.race([
        sql`
          UPDATE falhas_agentes
          SET resolvido = TRUE, resolvido_em = NOW(), resposta = ${respostaEspecialista || null}
          WHERE id = ${idFalha}
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      return true;
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    console.error("Erro ao marcar falha como resolvida:", error);
    return false;
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalFalhasNaoResolvidas: number;
  totalFalhasRecentesAgentes: Record<string, number>;
}> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      const [totalResult, porAgenteResult] = await Promise.all([
        Promise.race([
          sql<FalhaResult[]>`
            SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
          `,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
          ),
        ]),
        Promise.race([
          sql<Array<{ agente: string; total: number }>>`
            SELECT agente, COUNT(*) as total
            FROM falhas_agentes
            WHERE resolvido = FALSE
            AND criado_em > NOW() - INTERVAL '1 hour'
            GROUP BY agente
            ORDER BY total DESC
          `,
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
          ),
        ]),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      const totalFalhasNaoResolvidas = Array.isArray(totalResult) && totalResult.length > 0
        ? totalResult[0].total
        : 0;

      const totalFalhasRecentesAgentes = Array.isArray(porAgenteResult)
        ? porAgenteResult.reduce((acc, item) => {
            acc[item.agente] = item.total;
            return acc;
          }, {} as Record<string, number>)
        : {};

      return {
        totalFalhasNaoResolvidas,
        totalFalhasRecentesAgentes,
      };
    } catch (dbError) {
      if (timeoutId) clearTimeout(timeoutId);
      throw dbError;
    }
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      totalFalhasNaoResolvidas: 0,
      totalFalhasRecentesAgentes: {},
    };
  }
}

export async function notificarEspecialistaFalha(
  idFalha: number,
  agente: string,
  erro: string
): Promise<boolean> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);
    if (!especialista) {
      console.warn(`Nenhum especialista encontrado para o agente: ${agente}`);
      return false;
    }

    const mensagem = `
🚨 <b>Nova Falha Detectada</b>
Agente: ${agente}
Erro: ${erro}
ID da Falha: ${idFalha}
App: Receitinhas da Vovó Teresinha
    `;

    await enviarTelegram(mensagem);
    return true;
  } catch (error) {
    console.error("