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
        `Será retentado na próxima execução.\n`
      );
    } else {
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
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `⚠️ <b>Falha Registrada</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n`
    );
  } catch (error) {
    console.error("[registrarFalha] Erro ao registrar falha:", error);
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
        LIMIT 50
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return falhas;
  } catch (error) {
    console.error("[obterFalhasNaoResolvidas] Erro:", error);
    return [];
  }
}

export async function resolverFalha(falhaId: number): Promise<boolean> {
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

    return true;
  } catch (error) {
    console.error("[resolverFalha] Erro ao resolver falha:", error);
    return false;
  }
}

export async function escalacaoFalha(falhaRegistro: FalhaRegistro): Promise<void> {
  try {
    const contadorFalhas = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE agente = ${falhaRegistro.agente}
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = Array.isArray(contadorFalhas) && contadorFalhas.length > 0
      ? contadorFalhas[0].total
      : 0;

    if (totalFalhas >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🚨 <b>Escalação para Claude - Nível Crítico</b>\n` +
        `Agente: ${falhaRegistro.agente}\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `Erro: ${falhaRegistro.erro}\n`
      );
    } else if (totalFalhas >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(falhaRegistro.agente);
      await enviarTelegram(
        `📊 <b>Escalação para Gerente</b>\n` +
        `Gerente: ${gerente}\n` +
        `Agente: ${falhaRegistro.agente}\n` +
        `Total de falhas: ${totalFalhas}\n`
      );
    } else if (totalFalhas >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(falhaRegistro.agente);
      await enviarTelegram(
        `🔧 <b>Escalação para Especialista</b>\n` +
        `Especialista: ${especialista}\n` +
        `Agente: ${falhaRegistro.agente}\n` +
        `Total de falhas: ${totalFalhas}\n`
      );
    }
  } catch (error) {
    console.error("[escalacaoFalha] Erro:", error);
  }
}

export async function processarFalhas(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      await escalacaoFalha(falha);
    }

    if (falhas.length > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Backlog Crítico de Falhas</b>\n` +
        `Total: ${falhas.length}\n` +
        `Limite: ${LIMITE_BACKLOG}\n`
      );
    }
  } catch (error) {
    console.error("[processarFalhas] Erro:", error);
  }
}

export async function tratarWebhookMercadoPago(
  payload: unknown
): Promise<{ statusCode: number; body: string }> {
  const validacao = await validarAssinaturaMercadoPago(payload);

  if (!validacao.valid) {
    await registrarFalha(
      "webhook_mp_valida_assinatura",
      validacao.message,
      {
        payload,
        statusCode: validacao.statusCode,
      }
    );

    return {
      statusCode: validacao.statusCode,
      body: JSON.stringify({ error: validacao.message }),
    };
  }

  return {
    statusCode: 200,
    body: JSON.stringify({ success: true }),
  };
}
```