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
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout na Limpeza de Backlog</b>\n` +
        `Falha ao limpar registros antigos\n`
      );
    } else {
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
      );
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
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
    `;

    const contagem = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE AND agente = ${agente}
    `;

    const total = contagem[0]?.total || 0;

    if (total >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `🚨 <b>Falha Crítica Detectada</b>\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n` +
          `Contagem: ${total}\n` +
          `Especialista: @${especialista}\n`
        );
      }
    }

    if (total >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente) {
        await enviarTelegram(
          `🔴 <b>Escalação para Gerente</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas consecutivas: ${total}\n` +
          `Gerente: @${gerente}\n`
        );
      }
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalha(
  id: number,
  solucao: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, solucao = ${solucao}
      WHERE id = ${id}
    `;
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
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

export async function sincronizarStatusFalhas(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const response = await Promise.race([
        fetch(`${APP_URL}/api/agentes/${falha.agente}/status`, {
          headers: { "X-CRON-SECRET": CRON_SECRET || "" },
        }),
        new Promise<Response>((_, reject) =>
          setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
        ),
      ]);

      if (response.ok) {
        await resolverFalha(falha.id, "Status normalizado");
      }
    }
  } catch (error) {
    console.error("Erro ao sincronizar status das falhas:", error);
  }
}

export async function analisarTaxaErros(): Promise<{
  taxaErros: number;
  falhasTotal: number;
  recomendacao: string;
}> {
  try {
    const resultado = await sql<Array<{ total: number }>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
      AND resolvido = FALSE
    `;

    const falhasTotal = resultado[0]?.total || 0;
    const taxaErros = Math.min((falhasTotal / 100) * 100, 100);

    let recomendacao = "Sistema operacional normal";

    if (taxaErros >= 50) {
      recomendacao = "Escalação imediata para time de SRE necessária";
    } else if (taxaErros >= 30) {
      recomendacao = "Aumentar monitoramento e recursos";
    } else if (taxaErros >= 10) {
      recomendacao = "Investigação recomendada";
    }

    return { taxaErros, falhasTotal, recomendacao };
  } catch (error) {
    console.error("Erro ao analisar taxa de erros:", error);
    return { taxaErros: 0, falhasTotal: 0, recomendacao: "Erro na análise" };
  }
}