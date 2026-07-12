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
        `Excedido limite de ${DB_TIMEOUT}ms\n`
      );
    } else if (error instanceof Error) {
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `${error.message}\n`
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
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
    } else if (error instanceof Error) {
      console.error(`Erro ao registrar falha para ${agente}:`, error.message);
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
        `⚠️ <b>Timeout ao Obter Falhas</b>\n` +
        `Excedido limite de ${DB_TIMEOUT}ms\n`
      );
    } else if (error instanceof Error) {
      console.error("Erro ao obter falhas não resolvidas:", error.message);
    }
    return [];
  }
}

export async function resolverFalha(id: number, resolvido: boolean = true): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = ${resolvido}
        WHERE id = ${id}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Resolver Falha</b>\n` +
        `ID: ${id}\n`
      );
    } else if (error instanceof Error) {
      console.error(`Erro ao resolver falha ${id}:`, error.message);
    }
  }
}

export async function escalarFalha(falha: FalhaRegistro): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel();
    const gerente = await getGerenteResponsavel();

    const mensagem = `
🚨 <b>Falha Escalada - ${falha.agente}</b>
ID: ${falha.id}
Erro: <code>${falha.erro}</code>
Criado em: ${new Date(falha.criado_em).toLocaleString("pt-BR")}
    `.trim();

    if (especialista?.telegram_id) {
      await enviarTelegram(mensagem, especialista.telegram_id);
    }

    if (gerente?.telegram_id) {
      await enviarTelegram(mensagem, gerente.telegram_id);
    }

    await resolverFalha(falha.id, true);
  } catch (error) {
    if (error instanceof Error) {
      await enviarTelegram(
        `❌ <b>Erro ao Escalar Falha</b>\n` +
        `${error.message}\n`
      );
    }
  }
}

export async function processarFalhasAgentes(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    if (falhas.length === 0) {
      return;
    }

    await enviarTelegram(
      `📊 <b>Processamento de Falhas Iniciado</b>\n` +
      `Total de falhas não resolvidas: ${falhas.length}\n`
    );

    for (const falha of falhas) {
      await escalarFalha(falha);
    }
  } catch (error) {
    if (error instanceof Error) {
      await enviarTelegram(
        `❌ <b>Erro no Processamento de Falhas</b>\n` +
        `${error.message}\n`
      );
    }
  }
}

export async function verificarSaude(): Promise<{
  status: "saudavel" | "degradado" | "critico";
  taxa_erro: number;
  total_falhas: number;
}> {
  try {
    const resultado = await Promise.race<FalhaResult>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '2 hours'
      `.then(res => res[0] || { total: 0 }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total_falhas = (resultado as { total?: number })?.total || 0;
    const taxa_erro = Math.round((total_falhas / 100) * 100);

    let status: "saudavel" | "degradado" | "critico" = "saudavel";
    if (taxa_erro > 20 && taxa_erro <= 50) {
      status = "degradado";
    } else if (taxa_erro > 50) {
      status = "critico";
    }

    if (status !== "saudavel") {
      await enviarTelegram(
        `⚠️ <b>Status ${status.toUpperCase()}</b>\n` +
        `Taxa de erro: ${taxa_erro}%\n` +
        `Total de falhas: ${total_falhas}\n`
      );
    }

    return {
      status,
      taxa_erro,
      total_falhas,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout na Verificação de Saúde</b>\n` +
        `Excedido limite de ${DB_TIMEOUT}ms\n`
      );
    }
    return {
      status: "critico",
      taxa_erro: 100,
      total_falhas: 0,
    };
  }
}