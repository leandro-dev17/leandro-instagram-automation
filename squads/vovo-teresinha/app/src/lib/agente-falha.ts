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
        `Excedido limite de ${DB_TIMEOUT}ms\n`
      );
    } else {
      console.error("Erro ao limpar backlog:", error);
    }
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    const result = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    const totalFalhas = result[0]?.total || 0;

    if (totalFalhas > LIMITE_BACKLOG) {
      const especialista = await getEspecialistaResponsavel(agente);
      const gerente = await getGerenteResponsavel(especialista);

      await enviarTelegram(
        `🚨 <b>Alerta: Backlog de Falhas Elevado</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Total de falhas não resolvidas: ${totalFalhas}\n` +
        `Especialista responsável: ${especialista}\n` +
        `Gerente responsável: ${gerente}\n`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalhaAgente(
  falhaId: number,
  solucao: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, solucao = ${solucao}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID da falha: ${falhaId}\n` +
      `Solução: ${solucao}\n`
    );
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
      LIMIT 100
    `;

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function verificarTaxaErros(): Promise<{ taxa: number; critica: boolean }> {
  try {
    const result = await sql<Array<{ total: number; erros: number }>>`
      SELECT 
        COUNT(*) as total,
        SUM(CASE WHEN resolvido = FALSE THEN 1 ELSE 0 END) as erros
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
    `;

    const { total = 0, erros = 0 } = result[0] || {};
    const taxa = total > 0 ? (erros / total) * 100 : 0;
    const critica = taxa > 30;

    if (critica) {
      await enviarTelegram(
        `🔴 <b>Taxa de Erros Crítica</b>\n` +
        `Taxa: ${taxa.toFixed(2)}%\n` +
        `Erros: ${erros}/${total}\n`
      );
    }

    return { taxa, critica };
  } catch (error) {
    console.error("Erro ao verificar taxa de erros:", error);
    return { taxa: 0, critica: false };
  }
}

export async function notificarEquipeResponsavel(
  agente: string,
  erro: string,
  statusCode?: number
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(especialista);

    const mensagem = `
⚠️ <b>Falha no Agente: ${agente}</b>
Erro: ${erro}
${statusCode ? `Status: ${statusCode}` : ""}
Especialista: ${especialista}
Gerente: ${gerente}
Timestamp: ${new Date().toISOString()}
    `.trim();

    await enviarTelegram(mensagem);
  } catch (error) {
    console.error("Erro ao notificar equipe responsável:", error);
  }
}