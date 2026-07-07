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
    const countResult = await Promise.race<FalhaResult>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalAberto = Array.isArray(countResult) ? countResult[0]?.total || 0 : 0;

    if (totalAberto >= LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>ALERTA: Backlog de Falhas Crítico</b>\n` +
        `Total de falhas abertas: ${totalAberto}\n` +
        `Limite: ${LIMITE_BACKLOG}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
      return;
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    const especialista = await getEspecialistaResponsavel(agente);
    if (especialista) {
      await enviarTelegram(
        `⚠️ <b>Nova Falha Registrada</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Responsável: ${especialista}\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error("Timeout ao registrar falha");
    } else {
      console.error("Erro ao registrar falha:", error);
    }
  }
}

export async function verificarFalhasAbertasExcessivas(): Promise<boolean> {
  try {
    const result = await Promise.race<FalhaResult>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(result) ? result[0]?.total || 0 : 0;

    if (total > LIMITE_BACKLOG) {
      const gerente = await getGerenteResponsavel("sistema");
      await enviarTelegram(
        `🔴 <b>CRÍTICO: Backlog Excessivo</b>\n` +
        `Total: ${total} falhas abertas\n` +
        `Limite: ${LIMITE_BACKLOG}\n` +
        `Gerente responsável: ${gerente}\n`
      );
      return true;
    }

    return false;
  } catch (error) {
    console.error("Erro ao verificar falhas abertas:", error);
    return false;
  }
}

export async function resolverFalha(id: number, resolucao: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolucao = ${resolucao}, atualizado_em = NOW()
      WHERE id = ${id}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${id}\n` +
      `Resolução: ${resolucao}\n`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    await registrarFalha(
      "agente-falha",
      `Erro ao resolver falha ${id}: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
  }
}

export async function obterFalhasAbertas(): Promise<FalhaRegistro[]> {
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

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("Erro ao obter falhas abertas:", error);
    return [];
  }
}

export async function processarFalhaComEscalacao(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await registrarFalha(agente, erro, dados);

    const falhasDoAgente = await Promise.race<Array<{ count: string }>>([
      sql<Array<{ count: string }>>`
        SELECT COUNT(*) as count FROM falhas_agentes
        WHERE agente = ${agente} AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const count = Array.isArray(falhasDoAgente) 
      ? parseInt(falhasDoAgente[0]?.count || "0", 10)
      : 0;

    if (count >= LIMITE_ESPECIALISTA && count < LIMITE_GERENTE) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `⚠️ <b>Escalação para Especialista</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas: ${count}/${LIMITE_ESPECIALISTA}\n` +
        `Especialista: ${especialista}\n`
      );
    } else if (count >= LIMITE_GERENTE && count < LIMITE_CLAUDE) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🔴 <b>Escalação para Gerente</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas: ${count}/${LIMITE_GERENTE}\n` +
        `Gerente: ${gerente}\n`
      );
    } else if (count >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🚨 <b>CRÍTICO: Falhas Críticas Detectadas</b>\n` +
        `Agente: ${agente}\n` +
        `Total de falhas: ${count}\n` +
        `Requer análise técnica profunda\n`
      );
    }
  } catch (error) {
    console.error("Erro ao processar falha com escalação:", error);
  }
}
```