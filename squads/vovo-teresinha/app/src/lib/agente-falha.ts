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
      throw error;
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<FalhaRegistro | null> {
  try {
    const resultado = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
        RETURNING id, agente, erro, resolvido, criado_em
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(resultado) && resultado.length > 0) {
      const falha = resultado[0];
      await notificarFalha(agente, erro, dados);
      return falha;
    }

    return null;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
    }
    throw error;
  }
}

async function notificarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const contagem = await Promise.race<Array<FalhaResult>>([
      sql<Array<FalhaResult>>`
        SELECT COUNT(*)::int as total FROM falhas_agentes
        WHERE agente = ${agente}
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = Array.isArray(contagem) && contagem.length > 0 ? contagem[0].total : 0;

    if (totalFalhas >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `🚨 <b>Escalação para Especialista</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${totalFalhas}\n` +
          `Especialista: ${especialista}\n` +
          `Erro: ${erro}\n`
        );
      }
    }

    if (totalFalhas >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente) {
        await enviarTelegram(
          `🔴 <b>Escalação para Gerente</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${totalFalhas}\n` +
          `Gerente: ${gerente}\n` +
          `Erro: ${erro}\n`
        );
      }
    }

    if (totalFalhas >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `💀 <b>CRÍTICO: Múltiplas Falhas Detectadas</b>\n` +
        `Agente: ${agente}\n` +
        `Total de falhas: ${totalFalhas}\n` +
        `Última falha: ${erro}\n` +
        `Dados: ${JSON.stringify(dados)}\n`
      );
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Notificar Falha</b>\n` +
        `Agente: ${agente}\n`
      );
    }
  }
}

export async function resolverFalha(id: number, resolucao: string): Promise<void> {
  try {
    await Promise.race<void>([
      (async () => {
        await sql`
          UPDATE falhas_agentes
          SET resolvido = TRUE, resolucao = ${resolucao}
          WHERE id = ${id}
        `;
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${id}\n` +
      `Resolução: ${resolucao}\n`
    );
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Resolver Falha</b>\n` +
        `ID: ${id}\n`
      );
    }
    throw error;
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

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Obter Falhas Não Resolvidas</b>\n`
      );
    }
    return [];
  }
}

export async function executarAgenteFalha(): Promise<void> {
  try {
    if (!CRON_SECRET) {
      throw new Error("CRON_SECRET não configurado");
    }

    const falhas = await obterFalhasNaoResolvidas();

    if (falhas.length === 0) {
      return;
    }

    for (const falha of falhas) {
      if (falha.agente === "webhook_mp_valida_assinatura") {
        const payload = {
          agente: falha.agente,
          erro: falha.erro,
        };

        const resultado = await validarAssinaturaMercadoPago(payload);

        if (!resultado.valid) {
          const novaResolucao = `Validação retornou statusCode: ${resultado.statusCode}`;
          await resolverFalha(falha.id, novaResolucao);
        }
      }
    }

    await limparBacklogFalhas();
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro no Agente de Falhas</b>\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
    throw error;
  }
}