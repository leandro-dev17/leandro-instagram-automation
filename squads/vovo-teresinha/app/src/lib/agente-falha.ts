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
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length > 0) {
      const ids = falhasAntiga.map((f) => f.id);
      await sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${ids})
      `;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function verificarEscalacao(): Promise<void> {
  try {
    const falhasPendentes = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em ASC
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const agenteContagem: Record<string, number> = {};

    for (const falha of falhasPendentes) {
      agenteContagem[falha.agente] = (agenteContagem[falha.agente] || 0) + 1;
    }

    for (const [agente, contagem] of Object.entries(agenteContagem)) {
      if (contagem >= LIMITE_ESPECIALISTA && contagem < LIMITE_GERENTE) {
        const especialista = await getEspecialistaResponsavel(agente);
        await enviarTelegram(
          `⚠️ <b>Escalação Nível 1</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${contagem}\n`,
          [especialista]
        );
      } else if (contagem >= LIMITE_GERENTE && contagem < LIMITE_CLAUDE) {
        const gerente = await getGerenteResponsavel(agente);
        const especialista = await getEspecialistaResponsavel(agente);
        await enviarTelegram(
          `🔴 <b>Escalação Nível 2</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${contagem}\n`,
          [gerente, especialista]
        );
      } else if (contagem >= LIMITE_CLAUDE) {
        const gerente = await getGerenteResponsavel(agente);
        await enviarTelegram(
          `🚨 <b>Escalação Crítica</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${contagem}\n` +
          `Status: Requer análise de Claude\n`,
          [gerente]
        );
      }
    }
  } catch (error) {
    console.error("Erro ao verificar escalação:", error);
  }
}

export async function resolverFalha(id: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE
        WHERE id = ${id}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasPendentes(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
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
    console.error("Erro ao obter falhas pendentes:", error);
    return [];
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  total: number;
  pendentes: number;
  resolvidas: number;
}> {
  try {
    const resultado = await Promise.race<Array<{ total: number }>>(
      [
        sql`
          SELECT COUNT(*) as total
          FROM falhas_agentes
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]
    );

    const total = resultado[0]?.total || 0;

    const pendentes = await Promise.race<Array<{ total: number }>>(
      [
        sql`
          SELECT COUNT(*) as total
          FROM falhas_agentes
          WHERE resolvido = FALSE
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]
    );

    const pendentesCount = pendentes[0]?.total || 0;

    return {
      total,
      pendentes: pendentesCount,
      resolvidas: total - pendentesCount,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      total: 0,
      pendentes: 0,
      resolvidas: 0,
    };
  }
}
```