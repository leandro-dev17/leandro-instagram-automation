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
      sql`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length === 0) return;

    const ids = falhasAntiga.map((f) => f.id);
    await Promise.race([
      sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${ids})
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function escalarFalha(
  falhaId: number,
  agente: string
): Promise<void> {
  try {
    const falha = await Promise.race<FalhaRegistro | undefined>([
      sql`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${falhaId}
      `.then((rows) => (rows.length > 0 ? rows[0] : undefined)),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!falha) {
      console.warn(`Falha ${falhaId} não encontrada`);
      return;
    }

    const contadorEscalacoes = await Promise.race<FalhaResult[]>([
      sql`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const numeroFalhas = contadorEscalacoes[0]?.total || 0;

    if (numeroFalhas >= LIMITE_ESPECIALISTA) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `⚠️ <b>Escalação para Gerente</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Limite de especialista atingido (${numeroFalhas}/${LIMITE_ESPECIALISTA})\n`,
        [gerente]
      );
    } else if (numeroFalhas >= LIMITE_GERENTE) {
      await enviarTelegram(
        `🔴 <b>Escalação para Claude/IA</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Limite de gerente atingido (${numeroFalhas}/${LIMITE_GERENTE})\n`,
        ["claude", "ia-team"]
      );
    }
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
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
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql`
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
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function analisarTaxaErros(): Promise<{ taxa: number; critica: boolean }> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = resultado[0]?.total || 0;
    const taxa = total > 0 ? (total / 100) * 100 : 0;
    const critica = taxa > 30;

    if (critica) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Crítica</b>\n` +
        `Taxa: ${taxa.toFixed(2)}%\n` +
        `Falhas nas últimas 2h: ${total}\n` +
        `Status: CRÍTICO - Investigação necessária\n`,
        ["gerente", "especialista"]
      );
    }

    return { taxa, critica };
  } catch (error) {
    console.error("Erro ao analisar taxa de erros:", error);
    return { taxa: 0, critica: false };
  }
}
```