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
      const falhasAntiga = await Promise.race([
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
    } catch (error) {
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
      );
      throw error;
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const resultado = await sql<FalhaResult[]>`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
      RETURNING id;
    `;

    const totalFalhas = await sql<Array<{ count: string }>>`
      SELECT COUNT(*) as count FROM falhas_agentes
      WHERE resolvido = FALSE
      AND agente = ${agente}
    `;

    const count = parseInt(totalFalhas[0]?.count || "0", 10);

    if (count >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `⚠️ <b>Alerta: ${agente}</b>\n` +
          `Especialista notificado: ${especialista}\n` +
          `Total de falhas: ${count}\n`
        );
      }
    }

    if (count >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente) {
        await enviarTelegram(
          `🚨 <b>CRÍTICO: ${agente}</b>\n` +
          `Gerente notificado: ${gerente}\n` +
          `Total de falhas: ${count}\n`
        );
      }
    }

    if (count >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🔴 <b>ESCALAÇÃO MÁXIMA: ${agente}</b>\n` +
        `Total de falhas: ${count}\n` +
        `Ação imediata requerida!\n`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function marcarFalhaComoResolvida(falhaId: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    console.error("Erro ao marcar falha como resolvida:", error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT ${LIMITE_BACKLOG}
    `;
    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function verificarSaudeAgentes(): Promise<{
  saudavel: boolean;
  totalFalhas: number;
  agentesAfetados: string[];
}> {
  try {
    const falhasNaoResolvidas = await sql<Array<{ agente: string; count: string }>>`
      SELECT agente, COUNT(*) as count
      FROM falhas_agentes
      WHERE resolvido = FALSE
      GROUP BY agente
      HAVING COUNT(*) > 0
    `;

    const totalFalhas = falhasNaoResolvidas.reduce(
      (acc, f) => acc + parseInt(f.count, 10),
      0
    );
    const agentesAfetados = falhasNaoResolvidas.map((f) => f.agente);

    return {
      saudavel: totalFalhas === 0,
      totalFalhas,
      agentesAfetados,
    };
  } catch (error) {
    console.error("Erro ao verificar saúde dos agentes:", error);
    return {
      saudavel: false,
      totalFalhas: 0,
      agentesAfetados: [],
    };
  }
}

export async function executarDiagnosticoCompleto(): Promise<void> {
  try {
    const saude = await verificarSaudeAgentes();

    if (!saude.saudavel) {
      await enviarTelegram(
        `📊 <b>Diagnóstico Completo</b>\n` +
        `Total de falhas: ${saude.totalFalhas}\n` +
        `Agentes afetados: ${saude.agentesAfetados.join(", ")}\n`
      );
    }

    await limparBacklogFalhas();
  } catch (error) {
    console.error("Erro ao executar diagnóstico completo:", error);
    await enviarTelegram(
      `❌ <b>Erro no Diagnóstico</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}