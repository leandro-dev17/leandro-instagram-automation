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
      console.error("Erro ao limpar backlog de falhas:", error);
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const resultado = await Promise.race([
      sql<Array<FalhaResult>>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
        RETURNING (SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE) as total
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalFalhas = resultado[0]?.total || 0;

    if (totalFalhas > LIMITE_BACKLOG) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `⚠️ <b>Alerta: Limite de Backlog Excedido</b>\n` +
          `Agente: ${agente}\n` +
          `Total de falhas não resolvidas: ${totalFalhas}\n` +
          `Responsável: ${especialista}\n`
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n` +
        `Excedido limite de ${DB_TIMEOUT}ms\n`
      );
    } else {
      console.error("Erro ao registrar falha:", error);
    }
  }
}

export async function escalarFalha(
  falhaId: number,
  nivel: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await Promise.race([
      sql<Array<FalhaRegistro>>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(falha) || falha.length === 0) {
      throw new Error(`Falha ${falhaId} não encontrada`);
    }

    const registroFalha = falha[0];
    let responsavel: string | null = null;
    let mensagem = "";

    if (nivel === "especialista") {
      responsavel = await getEspecialistaResponsavel(registroFalha.agente);
      mensagem = `🔴 <b>Escalação para Especialista</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${registroFalha.agente}\n` +
        `Erro: ${registroFalha.erro}\n` +
        `Responsável: ${responsavel}\n`;
    } else if (nivel === "gerente") {
      responsavel = await getGerenteResponsavel(registroFalha.agente);
      mensagem = `🟠 <b>Escalação para Gerente</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${registroFalha.agente}\n` +
        `Erro: ${registroFalha.erro}\n` +
        `Responsável: ${responsavel}\n`;
    } else if (nivel === "claude") {
      mensagem = `🟡 <b>Escalação para Claude</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${registroFalha.agente}\n` +
        `Erro: ${registroFalha.erro}\n`;
    }

    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(mensagem);
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Escalar Falha</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Nível: ${nivel}\n` +
        `Excedido limite de ${DB_TIMEOUT}ms\n`
      );
    } else {
      console.error("Erro ao escalar falha:", error);
      throw error;
    }
  }
}

export async function verificarEstatisticasFalhas(): Promise<{
  total: number;
  naoResolvidas: number;
  ultimasHoras: number;
}> {
  try {
    const resultado = await Promise.race([
      sql<Array<{ total: number; nao_resolvidas: number; ultimas_horas: number }>>`
        SELECT
          (SELECT COUNT(*) FROM falhas_agentes) as total,
          (SELECT COUNT(*) FROM falhas_agentes WHERE resolvido = FALSE) as nao_resolvidas,
          (SELECT COUNT(*) FROM falhas_agentes WHERE criado_em > NOW() - INTERVAL '2 hours') as ultimas_horas
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(resultado) || resultado.length === 0) {
      return { total: 0, naoResolvidas: 0, ultimasHoras: 0 };
    }

    const stats = resultado[0];
    return {
      total: stats.total || 0,
      naoResolvidas: stats.nao_resolvidas || 0,
      ultimasHoras: stats.ultimas_horas || 0,
    };
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error("Timeout ao verificar estatísticas");
    } else {
      console.error("Erro ao verificar estatísticas:", error);
    }
    return { total: 0, naoResolvidas: 0, ultimasHoras: 0 };
  }
}

export async function monitorarTaxaErros(): Promise<void> {
  try {
    const stats = await verificarEstatisticasFalhas();

    if (stats.ultimasHoras > 0) {
      const taxaErro = (stats.ultimasHoras / (stats.total || 1)) * 100;

      if (taxaErro > 30) {
        await enviarTelegram(
          `🚨 <b>Taxa de Erros Elevada Detectada</b>\n` +
          `Taxa: ${taxaErro.toFixed(2)}%\n` +
          `Erros nas últimas 2h: ${stats.ultimasHoras}\n` +
          `Total não resolvidas: ${stats.naoResolvidas}\n`
        );
      }
    }
  } catch (error) {
    console.error("Erro ao monitorar taxa de erros:", error);
  }
}

export async function processarFalhasEmL