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
        `${error instanceof Error ? error.message : "Desconhecido"}\n`
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
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE)
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message !== "DB_TIMEOUT") {
      console.error(`Erro ao registrar falha para ${agente}:`, error);
    }
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race([
      sql<Array<FalhaRegistro>>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 100
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function marcarFalhaResolvida(falhaId: number): Promise<void> {
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
    if (error instanceof Error && error.message !== "DB_TIMEOUT") {
      console.error(`Erro ao marcar falha ${falhaId} como resolvida:`, error);
    }
  }
}

export async function processarFalhasEscaladas(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const tentativas = await obterTentativasFalha(falha.id);

      if (tentativas >= LIMITE_ESPECIALISTA && tentativas < LIMITE_GERENTE) {
        const gerente = await getGerenteResponsavel();
        if (gerente) {
          await enviarTelegram(
            `👔 <b>Escalação para Gerente</b>\n` +
            `Falha ID: ${falha.id}\n` +
            `Agente: ${falha.agente}\n` +
            `Erro: ${falha.erro}\n` +
            `Responsável: ${gerente}\n`
          );
        }
      } else if (tentativas >= LIMITE_GERENTE && tentativas < LIMITE_CLAUDE) {
        await enviarTelegram(
          `🤖 <b>Escalação para Claude AI</b>\n` +
          `Falha ID: ${falha.id}\n` +
          `Agente: ${falha.agente}\n` +
          `Erro: ${falha.erro}\n` +
          `Tentativas: ${tentativas}\n`
        );
      } else if (tentativas >= LIMITE_CLAUDE) {
        await marcarFalhaResolvida(falha.id);
        await enviarTelegram(
          `🔴 <b>Falha Crítica - Limite de Tentativas Atingido</b>\n` +
          `Falha ID: ${falha.id}\n` +
          `Agente: ${falha.agente}\n` +
          `Erro: ${falha.erro}\n` +
          `Tentativas: ${tentativas}\n`
        );
      }

      await incrementarTentativasFalha(falha.id);
    }
  } catch (error) {
    console.error("Erro ao processar falhas escaladas:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Processar Falhas Escaladas</b>\n` +
      `${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

async function obterTentativasFalha(falhaId: number): Promise<number> {
  try {
    const result = await Promise.race([
      sql<Array<{ tentativas: number }>>`
        SELECT COALESCE(COUNT(*), 0) as tentativas
        FROM falhas_agentes_tentativas
        WHERE falha_id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return result.length > 0 ? result[0].tentativas : 0;
  } catch (error) {
    console.error(`Erro ao obter tentativas da falha ${falhaId}:`, error);
    return 0;
  }
}

async function incrementarTentativasFalha(falhaId: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        INSERT INTO falhas_agentes_tentativas (falha_id, criado_em)
        VALUES (${falhaId}, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    if (error instanceof Error && error.message !== "DB_TIMEOUT") {
      console.error(`Erro ao incrementar tentativas da falha ${falhaId}:`, error);
    }
  }
}

export async function executarCronFalhas(): Promise<void> {
  try {
    const secret = new URL(APP_URL).searchParams.get("secret") || CRON_SECRET;

    const response = await Promise.race([
      fetch(`${APP_URL}/api/cron/processar-falhas`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = await response.json();
    console.log("Cron de falhas executado:", data);
  } catch (error) {
    console.error("Erro ao executar cron de falhas:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Executar Cron de Falhas</b>\n` +
      `${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}
```