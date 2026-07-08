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
        `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
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
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const contagem = await Promise.race<Array<FalhaResult>>([
      sql<Array<FalhaResult>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(contagem) && contagem.length > 0 ? contagem[0].total : 0;

    if (total >= LIMITE_ESPECIALISTA && total < LIMITE_GERENTE) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `⚠️ <b>Alerta - Especialista</b>\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n` +
          `@${especialista}\n`
        );
      }
    } else if (total >= LIMITE_GERENTE && total < LIMITE_CLAUDE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente) {
        await enviarTelegram(
          `🚨 <b>Alerta - Gerente</b>\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n` +
          `@${gerente}\n`
        );
      }
    } else if (total >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🔴 <b>CRÍTICO - Escalação para Claude</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas: ${total}\n` +
        `Ação imediata necessária!\n`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n`
      );
    }
  }
}

export async function resolverFalhasAgente(
  agente: string,
  resolvido: boolean = true
): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = ${resolvido}
        WHERE agente = ${agente}
        AND resolvido = ${!resolvido}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `✅ <b>Falhas Resolvidas</b>\n` +
      `Agente: ${agente}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falhas:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Resolver Falhas</b>\n` +
      `Agente: ${agente}\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
    );
  }
}

export async function listarFalhasAtivas(): Promise<FalhaRegistro[]> {
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

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("Erro ao listar falhas ativas:", error);
    return [];
  }
}

export async function executarCronLimpeza(request: Request): Promise<Response> {
  const authHeader = request.headers.get("authorization");
  const secret = authHeader?.replace("Bearer ", "");

  if (secret !== CRON_SECRET || !CRON_SECRET) {
    return new Response(JSON.stringify({ error: "Não autorizado" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await limparBacklogFalhas();
    return new Response(
      JSON.stringify({ success: true, message: "Limpeza executada com sucesso" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro ao executar cron de limpeza:", error);
    return new Response(
      JSON.stringify({
        error: "Erro ao executar limpeza",
        details: error instanceof Error ? error.message : "Desconhecido",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function processarWebhookValidacao(
  payload: WebhookValidacaoPayload
): Promise<Response> {
  try {
    if (!payload.agente || !payload.erro) {
      return new Response(
        JSON.stringify({ error: "Campos obrigatórios ausentes" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    await registrarFalha(payload.agente, payload.erro, payload.dados);

    return new Response(
      JSON.stringify({ success: true, message: "Falha registrada com sucesso" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro ao processar webhook de validação:", error);
    return new Response(
      JSON.stringify({
        error: "Erro ao processar webhook",
        details: error instanceof Error ? error.message : "Desconhecido",
      }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}

export async function processarWebhookMercadoPago(
  payload: unknown
): Promise<Response> {
  const validacao = await validarAssinaturaMercadoPago(payload);

  if (!validacao.valid) {