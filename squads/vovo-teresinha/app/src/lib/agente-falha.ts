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
      await enviarTelegram(
        `⚠️ <b>Erro na Limpeza de Backlog</b>\n` +
        `Erro: ${dbError instanceof Error ? dbError.message : "Desconhecido"}\n`
      );
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  statusCode?: number
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      await Promise.race([
        sql`
          INSERT INTO falhas_agentes (agente, erro, status_code, criado_em, resolvido)
          VALUES (${agente}, ${erro}, ${statusCode || 500}, NOW(), FALSE)
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      const resultado = (await sql`
        SELECT COUNT(*) as total FROM falhas_agentes 
        WHERE resolvido = FALSE AND agente = ${agente}
      `) as Array<FalhaResult>;

      const totalFalhas = resultado[0]?.total || 0;

      if (totalFalhas >= LIMITE_ESPECIALISTA) {
        const especialista = await getEspecialistaResponsavel(agente);
        if (especialista) {
          await enviarTelegram(
            `🚨 <b>ALERTA - Especialista Necessário</b>\n` +
            `Agente: ${agente}\n` +
            `Falhas: ${totalFalhas}\n` +
            `Responsável: @${especialista}\n` +
            `Erro: ${erro}\n`
          );
        }
      }

      if (totalFalhas >= LIMITE_GERENTE) {
        const gerente = await getGerenteResponsavel(agente);
        if (gerente) {
          await enviarTelegram(
            `🔴 <b>CRÍTICO - Gerente Notificado</b>\n` +
            `Agente: ${agente}\n` +
            `Falhas: ${totalFalhas}\n` +
            `Responsável: @${gerente}\n`
          );
        }
      }
    } catch (dbError) {
      console.error(`Erro ao registrar falha: ${dbError}`);
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    try {
      await Promise.race([
        sql`
          UPDATE falhas_agentes
          SET resolvido = TRUE, resolucao = ${resolucao}, atualizado_em = NOW()
          WHERE id = ${falhaId}
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      if (timeoutId) clearTimeout(timeoutId);

      await enviarTelegram(
        `✅ <b>Falha Resolvida</b>\n` +
        `ID: ${falhaId}\n` +
        `Resolução: ${resolucao}\n`
      );
    } catch (dbError) {
      console.error(`Erro ao resolver falha: ${dbError}`);
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("DB_TIMEOUT");
    }, DB_TIMEOUT);

    const falhas = (await Promise.race([
      sql`
        SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ])) as FalhaRegistro[];

    if (timeoutId) clearTimeout(timeoutId);

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error(`Erro ao obter falhas não resolvidas: ${error}`);
    return [];
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function notificarFalhasAcumuladas(): Promise<void> {
  let timeoutId: NodeJS.Timeout | null = null;

  try {
    timeoutId = setTimeout(() => {
      throw new Error("HTTP_TIMEOUT");
    }, HTTP_TIMEOUT);

    const falhas = await obterFalhasNaoResolvidas();

    if (timeoutId) clearTimeout(timeoutId);

    if (falhas.length > LIMITE_BACKLOG * 0.8) {
      await enviarTelegram(
        `⚠️ <b>Backlog Crítico de Falhas</b>\n` +
        `Total de falhas não resolvidas: ${falhas.length}\n` +
        `Limite: ${LIMITE_BACKLOG}\n` +
        `Ação necessária imediatamente!\n`
      );
    }

    const agentesFalhas: { [key: string]: number } = {};
    falhas.forEach((falha) => {
      agentesFalhas[falha.agente] = (agentesFalhas[falha.agente] || 0) + 1;
    });

    for (const [agente, count] of Object.entries(agentesFalhas)) {
      if (count >= LIMITE_CLAUDE) {
        await enviarTelegram(
          `🤖 <b>Análise Claude Necessária</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas recorrentes: ${count}\n`
        );
      }
    }
  } catch (error) {
    console.error(`Erro ao notificar falhas acumuladas: ${error}`);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}
```