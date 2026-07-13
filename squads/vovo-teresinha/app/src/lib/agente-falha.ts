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
        SELECT * FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        AND resolvido = TRUE
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length === 0) {
      return;
    }

    const idsParaRemover = falhasAntiga.map((f) => f.id);

    await Promise.race([
      sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${idsParaRemover})
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    console.log(`Limpas ${falhasAntiga.length} falhas antigas do backlog`);
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function processarFalhasEscalonadas(): Promise<void> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT * FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em ASC
        LIMIT 10
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    for (const falha of falhas) {
      await escalonarFalha(falha);
    }
  } catch (error) {
    console.error("Erro ao processar falhas escalonadas:", error);
  }
}

async function escalonarFalha(falha: FalhaRegistro): Promise<void> {
  const tentativasEspecialista = await contarTentativas(falha.id, "especialista");
  const tentativasGerente = await contarTentativas(falha.id, "gerente");

  if (tentativasEspecialista < LIMITE_ESPECIALISTA) {
    const especialista = await getEspecialistaResponsavel(falha.agente);
    await enviarTelegram(
      `⚠️ <b>Falha em Escalonamento</b>\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `Tentativa ${tentativasEspecialista + 1}/${LIMITE_ESPECIALISTA}`,
      [especialista]
    );
    await registrarTentativa(falha.id, "especialista");
  } else if (tentativasGerente < LIMITE_GERENTE) {
    const gerente = await getGerenteResponsavel(falha.agente);
    await enviarTelegram(
      `🔴 <b>Falha Crítica - Nível Gerente</b>\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `Tentativa ${tentativasGerente + 1}/${LIMITE_GERENTE}`,
      [gerente]
    );
    await registrarTentativa(falha.id, "gerente");
  } else {
    await marcarComoResolvido(falha.id);
  }
}

async function contarTentativas(falhaId: number, nivel: string): Promise<number> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult>`
        SELECT COUNT(*) as total FROM tentativas_escalonamento
        WHERE falha_id = ${falhaId} AND nivel = ${nivel}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
    return resultado.length > 0 ? resultado[0].total : 0;
  } catch (error) {
    console.error("Erro ao contar tentativas:", error);
    return 0;
  }
}

async function registrarTentativa(falhaId: number, nivel: string): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO tentativas_escalonamento (falha_id, nivel, criado_em)
        VALUES (${falhaId}, ${nivel}, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error("Erro ao registrar tentativa:", error);
  }
}

async function marcarComoResolvido(falhaId: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, atualizado_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error("Erro ao marcar falha como resolvida:", error);
  }
}

export async function cron(req: Request): Promise<Response> {
  if (req.method !== "POST") {
    return new Response("Método não permitido", { status: 405 });
  }

  const token = req.headers.get("x-cron-secret");
  if (token !== CRON_SECRET) {
    return new Response("Não autorizado", { status: 401 });
  }

  try {
    await Promise.all([
      processarFalhasEscalonadas(),
      limparBacklogFalhas(),
    ]);

    return new Response(
      JSON.stringify({ success: true, message: "CRON executado com sucesso" }),
      { status: 200, headers: { "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Erro no CRON:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Erro ao executar CRON" }),
      { status: 500, headers: { "Content-Type": "application/json" } }
    );
  }
}