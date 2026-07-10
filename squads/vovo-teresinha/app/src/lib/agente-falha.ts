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
      console.error("Erro ao limpar backlog de falhas:", error);
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<FalhaRegistro | null> {
  try {
    const resultado = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
        RETURNING id, agente, erro, resolvido, criado_em
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return resultado[0] || null;
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    return null;
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
        LIMIT ${LIMITE_BACKLOG}
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

export async function resolverFalha(
  falhaId: number,
  resolvidoPor: string
): Promise<boolean> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolvido_por = ${resolvidoPor}, resolvido_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return true;
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    return false;
  }
}

export async function executarAgenteFalha(): Promise<{ success: boolean; message: string }> {
  try {
    const falhasNaoResolvidas = await obterFalhasNaoResolvidas();

    if (falhasNaoResolvidas.length === 0) {
      return { success: true, message: "Nenhuma falha pendente" };
    }

    const falhasCriticas = falhasNaoResolvidas.filter(
      (f) => f.erro.toLowerCase().includes("crítico") || 
             f.erro.toLowerCase().includes("critical")
    );

    if (falhasCriticas.length > 0) {
      const especialista = await getEspecialistaResponsavel();
      
      if (especialista && falhasCriticas.length >= LIMITE_ESPECIALISTA) {
        await enviarTelegram(
          `🚨 <b>Falhas Críticas Detectadas</b>\n` +
          `Quantidade: ${falhasCriticas.length}\n` +
          `Responsável: ${especialista}\n` +
          `Detalhes: ${falhasCriticas.map(f => f.erro).join("; ")}`
        );
      }
    }

    const falhasAltas = falhasNaoResolvidas.filter(
      (f) => !f.erro.toLowerCase().includes("crítico") &&
             !f.erro.toLowerCase().includes("critical")
    );

    if (falhasAltas.length >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel();
      
      if (gerente) {
        await enviarTelegram(
          `⚠️ <b>Falhas em Nível de Gerência</b>\n` +
          `Quantidade: ${falhasAltas.length}\n` +
          `Responsável: ${gerente}`
        );
      }
    }

    return {
      success: true,
      message: `Processadas ${falhasNaoResolvidas.length} falhas`,
    };
  } catch (error) {
    const mensagem = error instanceof Error ? error.message : "Erro desconhecido";
    console.error("Erro ao executar agente de falha:", error);
    
    await enviarTelegram(
      `❌ <b>Erro no Agente de Falhas</b>\n` +
      `Mensagem: ${mensagem}`
    );

    return {
      success: false,
      message: `Erro ao executar agente: ${mensagem}`,
    };
  }
}

export async function contarFalhas(): Promise<number> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return resultado[0]?.total || 0;
  } catch (error) {
    console.error("Erro ao contar falhas:", error);
    return 0;
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  total: number;
  criticas: number;
  altas: number;
  ultimas24h: number;
}> {
  try {
    const [totalResult, criticasResult, altasResult, ultimas24Result] = await Promise.all([
      sql<FalhaResult[]>`SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE`,
      sql<FalhaResult[]>`SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE AND erro ILIKE '%crítico%'`,
      sql<FalhaResult[]>`SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE AND erro NOT ILIKE '%crítico%'`,
      sql<FalhaResult[]>`SELECT COUNT(*) as total FROM falhas_agentes WHERE criado_em > NOW() - INTERVAL '24 hours'`,
    ]);

    return {
      total: totalResult[0]?.total || 0,
      criticas: criticasResult[0]?.total || 0,
      altas: altasResult[0]?.total || 0,
      ultimas24h: ultimas24Result[0]?.total || 0,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      total: 0,
      criticas: 0,
      altas: 0,
      ultimas24h: 0,
    };
  }
}