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
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}`
      );
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  statusCode?: number
): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes (agente, erro, status_code, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${statusCode || 500}, false, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await verificarLimiteErros(agente);
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function verificarLimiteErros(agente: string): Promise<void> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
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

    const totalErros = resultado[0]?.total || 0;

    if (totalErros >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `🚨 <b>Alerta de Falhas - ${agente}</b>\n` +
        `Erros na última hora: ${totalErros}\n` +
        `Responsável: ${especialista || "Desconhecido"}\n` +
        `URL: ${APP_URL}/admin/falhas`
      );
    }

    if (totalErros >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🔴 <b>Crítico - ${agente}</b>\n` +
        `Erros críticos detectados: ${totalErros}\n` +
        `Gerente: ${gerente || "Desconhecido"}\n` +
        `Ação imediata necessária!`
      );
    }
  } catch (error) {
    console.error("Erro ao verificar limite de erros:", error);
  }
}

export async function resolverFalha(id: number, resolucao: string): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
        WHERE id = ${id}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${id}\n` +
      `Resolução: ${resolucao}`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasNaoResolvidas(
  agente?: string
): Promise<FalhaRegistro[]> {
  try {
    const resultado = await Promise.race<FalhaRegistro[]>([
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

    return resultado;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalNaoResolvidas: number;
  totalResolvidasHoje: number;
  taxaResolucao: number;
}> {
  try {
    const naoResolvidas = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const resolvidasHoje = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = TRUE
        AND resolvido_em >= CURRENT_DATE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalCriadasHoje = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE criado_em >= CURRENT_DATE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalNaoResolvidasValue = naoResolvidas[0]?.total || 0;
    const totalResolvidasHojeValue = resolvidasHoje[0]?.total || 0;
    const totalCriadasHojeValue = totalCriadasHoje[0]?.total || 0;

    const taxaResolucao =
      totalCriadasHojeValue > 0
        ? Math.round((totalResolvidasHojeValue / totalCriadasHojeValue) * 100)
        : 0;

    return {
      totalNaoResolvidas: totalNaoResolvidasValue,
      totalResolvidasHoje: totalResolvidasHojeValue,
      taxaResolucao,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      totalNaoResolvidas: 0,
      totalResolvidasHoje: 0,
      taxaResolucao: 0,
    };
  }
}
```