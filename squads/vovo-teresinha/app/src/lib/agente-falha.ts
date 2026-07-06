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
      const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `Detalhes: ${errorMessage}\n`
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
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const resultado = await Promise.race<[FalhaResult]>([
      sql<[FalhaResult]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalAberta = resultado[0]?.total || 0;

    if (totalAberta > LIMITE_BACKLOG) {
      await enviarTelegram(
        `⚠️ <b>Backlog de Falhas Crítico</b>\n` +
        `Total: ${totalAberta} registros abertos\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    if (errorMessage !== "DB_TIMEOUT") {
      console.error(`Erro ao registrar falha: ${errorMessage}`);
    }
  }
}

export async function obterFalhasAberta(): Promise<FalhaRegistro[]> {
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

    return falhas || [];
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    if (errorMessage !== "DB_TIMEOUT") {
      console.error(`Erro ao obter falhas: ${errorMessage}`);
    }
    return [];
  }
}

export async function resolverFalha(
  id: number
): Promise<boolean> {
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

    return true;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    if (errorMessage !== "DB_TIMEOUT") {
      console.error(`Erro ao resolver falha: ${errorMessage}`);
    }
    return false;
  }
}

export async function analisarFalhaComClaude(
  falha: FalhaRegistro
): Promise<string | null> {
  try {
    const resposta = await Promise.race<Response>([
      fetch(`${APP_URL}/api/ia/analise-falha`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CRON-SECRET": CRON_SECRET || "",
        },
        body: JSON.stringify({
          id: falha.id,
          agente: falha.agente,
          erro: falha.erro,
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);

    if (!resposta.ok) {
      return null;
    }

    const dados = (await resposta.json()) as { analise: string };
    return dados.analise || null;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    if (errorMessage !== "HTTP_TIMEOUT") {
      console.error(`Erro ao analisar falha com Claude: ${errorMessage}`);
    }
    return null;
  }
}

export async function notificarEspecialista(
  falha: FalhaRegistro
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(falha.agente);

    if (especialista) {
      await enviarTelegram(
        `📋 <b>Falha Atribuída ao Especialista</b>\n` +
        `Especialista: ${especialista}\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `ID: ${falha.id}\n`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error(`Erro ao notificar especialista: ${errorMessage}`);
  }
}

export async function notificarGerente(
  totalAberta: number
): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel();

    if (gerente) {
      await enviarTelegram(
        `👔 <b>Relatório para Gerência</b>\n` +
        `Gerente: ${gerente}\n` +
        `Falhas em Aberto: ${totalAberta}\n` +
        `Limite Crítico: ${LIMITE_BACKLOG}\n`
      );
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro desconhecido";
    console.error(`Erro ao notificar gerente: ${errorMessage}`);
  }
}

export async function processarFalhasAgentes(): Promise<void> {
  try {
    const falhas = await obterFalhasAberta();

    for (const falha of falhas) {
      const analise = await analisarFalhaComClaude(falha);

      if (analise) {
        await notificarEspecialista(falha);
        await resolverFalha(falha.id);
      }
    }

    const resultado = await Promise.race<[FalhaResult]>([
      sql<[FalhaResult]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalAberta = resultado[0]?.total || 0;

    if (totalAberta > LIMITE_BACKLOG) {
      await notificarGerente(totalAberta);
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Erro