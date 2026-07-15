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
        SELECT id FROM falhas_agentes 
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length > 0) {
      const ids = falhasAntiga.map(f => f.id);
      await sql`DELETE FROM falhas_agentes WHERE id = ANY(${ids})`;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes 
        SET resolvido = TRUE, atualizado_em = NOW()
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

export async function obterFalhasNaoResolvidas(
  agente?: string
): Promise<FalhaRegistro[]> {
  try {
    const result = await Promise.race<FalhaRegistro[]>([
      agente
        ? sql`
            SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes 
            WHERE resolvido = FALSE AND agente = ${agente}
            ORDER BY criado_em DESC
            LIMIT 10
          `
        : sql`
            SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes 
            WHERE resolvido = FALSE
            ORDER BY criado_em DESC
            LIMIT 20
          `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return result;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function contarFalhasRecentes(): Promise<number> {
  try {
    const result = await Promise.race<FalhaResult[]>([
      sql`
        SELECT COUNT(*) as total FROM falhas_agentes 
        WHERE criado_em > NOW() - INTERVAL '2 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return result[0]?.total || 0;
  } catch (error) {
    console.error("Erro ao contar falhas recentes:", error);
    return 0;
  }
}

export async function escalarFalha(
  falhaId: number,
  agente: string,
  motivo: string
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(agente);

    await Promise.race([
      sql`
        UPDATE falhas_agentes 
        SET escalado_para = ${especialista}, motivo_escalacao = ${motivo}
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `⬆️ <b>Falha Escalada</b>\n` +
      `Agente: ${agente}\n` +
      `Motivo: ${motivo}\n` +
      `Escalado para: ${especialista}\n` +
      `Gerente: ${gerente}\n`,
      [especialista, gerente]
    );
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function analisarTendenciasFalhas(): Promise<Record<string, number>> {
  try {
    const result = await Promise.race<Array<{ agente: string; total: number }>>([
      sql`
        SELECT agente, COUNT(*) as total FROM falhas_agentes 
        WHERE criado_em > NOW() - INTERVAL '24 hours'
        GROUP BY agente
        ORDER BY total DESC
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const tendencias: Record<string, number> = {};
    result.forEach(row => {
      tendencias[row.agente] = row.total;
    });

    return tendencias;
  } catch (error) {
    console.error("Erro ao analisar tendências de falhas:", error);
    return {};
  }
}

export async function notificarTimeOps(
  assunto: string,
  detalhes: string,
  severidade: "baixa" | "media" | "alta" | "critica"
): Promise<void> {
  try {
    const emoji = {
      baixa: "ℹ️",
      media: "⚠️",
      alta: "🔴",
      critica: "🆘",
    }[severidade];

    await enviarTelegram(
      `${emoji} <b>${assunto}</b>\n` +
      `${detalhes}\n` +
      `Severidade: ${severidade.toUpperCase()}\n` +
      `Timestamp: ${new Date().toISOString()}`,
      ["ops-team"]
    );
  } catch (error) {
    console.error("Erro ao notificar time OPS:", error);
  }
}

export async function verificarStatusSistema(): Promise<{
  saudavel: boolean;
  taxaErro: number;
  falhasAbertas: number;
  agentesComProblema: string[];
}> {
  try {
    const falhasAbertas = await obterFalhasNaoResolvidas();
    const tendencias = await analisarTendenciasFalhas();
    const totalRecente = await contarFalhasRecentes();

    const agentesComProblema = Object.entries(tendencias)
      .filter(([_, count]) => count > LIMITE_ESPECIALISTA)
      .map(([agente]) => agente);

    const taxaErro = totalRecente > 0 ? (falhasAbertas.length / totalRecente) * 100 : 0;
    const saudavel = taxaErro < 10 && agentesComProblema.length === 0;

    return {
      saudavel,
      taxaErro: Math.round(taxaErro * 100) / 100,
      falhasAbertas: falhasAbertas.length,
      agentesComProblema,
    };
  } catch (error) {
    console.error("Erro ao verificar status do sistema:", error);
    return {
      saudavel: false,
      taxaErro: 0,
      falhasAbertas: 0,
      agentesComProblema: [],
    };
  }
}
```