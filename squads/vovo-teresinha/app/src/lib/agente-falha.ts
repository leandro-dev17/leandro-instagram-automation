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
        `${error instanceof Error ? error.message : String(error)}\n`
      );
    }
    throw error;
  }
}

export async function registrarFalha(agente: string, erro: string, dados?: Record<string, unknown>): Promise<void> {
  try {
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    const [backlogResult] = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    if (backlogResult && backlogResult.total > LIMITE_BACKLOG) {
      await enviarTelegram(
        `⚠️ <b>Backlog de Falhas Elevado</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas em aberto: ${backlogResult.total}\n`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function processarFalhasAgentes(): Promise<void> {
  try {
    const falhas = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em ASC
        LIMIT ${LIMITE_ESPECIALISTA}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(falhas) || falhas.length === 0) {
      return;
    }

    for (const falha of falhas) {
      try {
        const especialista = await getEspecialistaResponsavel(falha.agente);
        
        if (especialista) {
          await enviarTelegram(
            `🔴 <b>Falha Detectada - ${falha.agente}</b>\n` +
            `Erro: ${falha.erro}\n` +
            `Atribuído a: ${especialista}\n` +
            `ID: ${falha.id}\n`
          );

          await sql`
            UPDATE falhas_agentes
            SET responsavel = ${especialista}
            WHERE id = ${falha.id}
          `;
        }
      } catch (error) {
        console.error(`Erro ao processar falha ${falha.id}:`, error);
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Processar Falhas</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro ao Processar Falhas Agentes</b>\n` +
        `${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
}

export async function resolverFalha(falhaId: number, solucao: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, solucao = ${solucao}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Solução: ${solucao}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    throw error;
  }
}

export async function obterEstatisticasFalhas(): Promise<{ total: number; aberto: number; resolvido: number }> {
  try {
    const stats = await Promise.race<Array<{ total: number; aberto: number; resolvido: number }>>([
      sql<Array<{ total: number; aberto: number; resolvido: number }>>`
        SELECT
          COUNT(*) as total,
          COUNT(CASE WHEN resolvido = FALSE THEN 1 END) as aberto,
          COUNT(CASE WHEN resolvido = TRUE THEN 1 END) as resolvido
        FROM falhas_agentes
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(stats) && stats.length > 0) {
      return stats[0];
    }

    return { total: 0, aberto: 0, resolvido: 0 };
  } catch (error) {
    console.error("Erro ao obter estatísticas:", error);
    return { total: 0, aberto: 0, resolvido: 0 };
  }
}

export async function sincronizarComWebhookMP(webhookData: WebhookMercadoPagoPayload): Promise<void> {
  try {
    const validacao = await validarAssinaturaMercadoPago(webhookData);

    if (!validacao.valid) {
      if (validacao.statusCode === 400) {
        await registrarFalha(
          "webhook_mp_valida_assinatura",
          `Validação falhou: ${validacao.message}`,
          { webhookData, statusCode: validacao.statusCode }
        );
      }
      throw new Error(`Webhook inválido: ${validacao.message}`);
    }

    await sql`
      INSERT INTO webhook_mp_processados (tipo, dados, processado_em)
      VALUES (${webhookData.type}, ${JSON.stringify(webhookData)}, NOW())
    `;
  } catch (error) {
    await registrarFalha(
      "webhook_mp_sincronizacao",
      error instanceof Error ? error.message : "Erro desconhecido",
      { webhookData }
    );
  }
}
```