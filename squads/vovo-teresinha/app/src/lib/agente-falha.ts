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
      const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `Erro: ${errorMsg}\n`
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
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error(`Erro ao registrar falha para ${agente}:`, errorMsg);
  }
}

export async function obterBacklogFalhas(): Promise<FalhaRegistro[]> {
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
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro ao obter backlog de falhas:", errorMsg);
    return [];
  }
}

export async function contarBacklogFalhas(): Promise<number> {
  try {
    const result = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return result?.[0]?.total || 0;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro ao contar backlog de falhas:", errorMsg);
    return 0;
  }
}

export async function escalarFalha(falhaId: number): Promise<void> {
  try {
    const falha = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!falha || falha.length === 0) {
      return;
    }

    const falhaRegistro = falha[0];
    const especialista = await getEspecialistaResponsavel(falhaRegistro.agente);

    if (especialista) {
      await enviarTelegram(
        `⚠️ <b>Falha Escalada para Especialista</b>\n` +
        `Agente: ${falhaRegistro.agente}\n` +
        `Erro: ${falhaRegistro.erro}\n` +
        `Especialista: ${especialista}\n`
      );
    } else {
      const gerente = await getGerenteResponsavel(falhaRegistro.agente);
      if (gerente) {
        await enviarTelegram(
          `⚠️ <b>Falha Escalada para Gerente</b>\n` +
          `Agente: ${falhaRegistro.agente}\n` +
          `Erro: ${falhaRegistro.erro}\n` +
          `Gerente: ${gerente}\n`
        );
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro ao escalar falha:", errorMsg);
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
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
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro ao resolver falha:", errorMsg);
  }
}

export async function processarFalhasAbertos(): Promise<void> {
  try {
    const backlogCount = await contarBacklogFalhas();

    if (backlogCount > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Backlog de Falhas Crítico</b>\n` +
        `Total de falhas abertas: ${backlogCount}\n` +
        `Limite: ${LIMITE_BACKLOG}\n`
      );

      const falhas = await obterBacklogFalhas();
      for (const falha of falhas.slice(0, LIMITE_ESPECIALISTA)) {
        await escalarFalha(falha.id);
      }
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro ao processar falhas abertas:", errorMsg);
  }
}

export async function handleWebhookValidacao(
  payload: WebhookValidacaoPayload
): Promise<{ statusCode: number; message: string }> {
  try {
    if (!payload.agente || !payload.erro) {
      return {
        statusCode: 400,
        message: "Campos obrigatórios ausentes",
      };
    }

    await registrarFalha(payload.agente, payload.erro, payload.dados);

    return {
      statusCode: 201,
      message: "Falha registrada com sucesso",
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : "Erro desconhecido";
    return {
      statusCode: 500,
      message: `Erro ao registrar falha: ${errorMsg}`,
    };
  }
}
```