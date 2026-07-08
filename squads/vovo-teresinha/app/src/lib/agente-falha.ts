```typescript
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
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const contagem = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(contagem) && contagem[0] ? contagem[0].total : 0;

    if (total >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista?.telegram_id) {
        await enviarTelegram(
          `🚨 <b>Alerta de Falha Escalada</b>\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n` +
          `Ocorrências (1h): ${total}`,
          especialista.telegram_id
        );
      }
    }

    if (total >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente?.telegram_id) {
        await enviarTelegram(
          `🔴 <b>Falha Crítica - Escalação Gerencial</b>\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n` +
          `Ocorrências (1h): ${total}`,
          gerente.telegram_id
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n` +
        `Será retentado na próxima execução.`
      );
    } else {
      throw error;
    }
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolução: ${resolucao}`
    );
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Resolver Falha</b>\n` +
        `ID: ${falhaId}\n` +
        `Será retentado na próxima execução.`
      );
    } else {
      throw error;
    }
  }
}

export async function obterFalhasNaoResolvidas(
  agente?: string
): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      agente
        ? sql<FalhaRegistro[]>`
            SELECT id, agente, erro, resolvido, criado_em
            FROM falhas_agentes
            WHERE agente = ${agente}
            AND resolvido = FALSE
            ORDER BY criado_em DESC
            LIMIT ${LIMITE_BACKLOG}
          `
        : sql<FalhaRegistro[]>`
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
      await enviarTelegram(
        `⚠️ <b>Timeout ao Obter Falhas</b>\n` +
        `Agente: ${agente || "Todos"}\n` +
        `Será retentado na próxima execução.`
      );
      return [];
    } else {
      throw error;
    }
  }
}

export async function notificarEquipeIncidente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const mensagem =
      `🆘 <b>Incidente Detectado</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n` +
      `Timestamp: ${new Date().toISOString()}\n` +
      (dados ? `Contexto: ${JSON.stringify(dados)}` : "");

    await enviarTelegram(mensagem);

    await registrarFalha(agente, erro, dados);
  } catch (error) {
    throw error;
  }
}

export async function verificarSaudeAgentesCriticos(): Promise<void> {
  try {
    const falhasRecentes = await Promise.race<
      Array<{ agente: string; total: number }>
    >([
      sql<Array<{ agente: string; total: number }>>`
        SELECT agente, COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '1 hour'
        AND resolvido = FALSE
        GROUP BY agente
        HAVING COUNT(*) > ${LIMITE_CLAUDE}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(falhasRecentes) && falhasRecentes.length > 0) {
      const relatorio = falhasRecentes
        .map((f) => `${f.agente}: ${f.total} falhas`)
        .join("\n");

      await enviarTelegram(
        `🆘 <b>Relatório de Saúde dos Agentes</b>\n` +
        `Agentes Críticos:\n` +
        relatorio
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout na Verificação