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

    if (Array.isArray(resultado) && resultado.length > 0) {
      return resultado[0];
    }
    return null;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Registrar Falha</b>\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
    } else {
      console.error("Erro ao registrar falha:", error);
    }
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

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Obter Falhas</b>\n` +
        `Limite de ${DB_TIMEOUT}ms excedido\n`
      );
    } else {
      console.error("Erro ao obter falhas não resolvidas:", error);
    }
    return [];
  }
}

export async function marcarFalhaComoResolvida(falhaId: number): Promise<boolean> {
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

    return true;
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Marcar Falha como Resolvida</b>\n` +
        `ID: ${falhaId}\n`
      );
    } else {
      console.error("Erro ao marcar falha como resolvida:", error);
    }
    return false;
  }
}

export async function escalarFalhaParaEspecialista(falha: FalhaRegistro): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(falha.agente);

    if (!especialista) {
      await enviarTelegram(
        `🚨 <b>Falha Crítica - Sem Especialista</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n`
      );
      return;
    }

    await enviarTelegram(
      `🔴 <b>Escalação para Especialista</b>\n` +
      `Especialista: ${especialista}\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n`
    );
  } catch (error) {
    console.error("Erro ao escalar falha para especialista:", error);
  }
}

export async function escalarFalhaParaGerente(falha: FalhaRegistro): Promise<void> {
  try {
    const gerente = await getGerenteResponsavel(falha.agente);

    if (!gerente) {
      await enviarTelegram(
        `🚨 <b>Falha Crítica - Sem Gerente</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n`
      );
      return;
    }

    await enviarTelegram(
      `🔴 <b>Escalação para Gerente</b>\n` +
      `Gerente: ${gerente}\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n`
    );
  } catch (error) {
    console.error("Erro ao escalar falha para gerente:", error);
  }
}

export async function processarFalhasComErroAlto(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      const contagemFalhas = await Promise.race<FalhaResult[]>([
        sql<FalhaResult[]>`
          SELECT COUNT(*) as total
          FROM falhas_agentes
          WHERE agente = ${falha.agente}
          AND resolvido = FALSE
          AND criado_em > NOW() - INTERVAL '2 hours'
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      const total = Array.isArray(contagemFalhas) && contagemFalhas.length > 0
        ? contagemFalhas[0].total
        : 0;

      if (total >= LIMITE_CLAUDE) {
        await enviarTelegram(
          `🤖 <b>Acionamento de IA Claude</b>\n` +
          `Agente: ${falha.agente}\n` +
          `Falhas (2h): ${total}\n`
        );
      } else if (total >= LIMITE_GERENTE) {
        await escalarFalhaParaGerente(falha);
      } else if (total >= LIMITE_ESPECIALISTA) {
        await escalarFalhaParaEspecialista(falha);
      }
    }
  } catch (error) {
    console.error("Erro ao processar falhas com erro alto:", error);
  }
}

export async function executarAgenteFalhaViaCron(cronSecret: string): Promise<{ success: boolean; message: string }> {
  if (cronSecret !== CRON_SECRET) {
    return {
      success: false,
      message: "Secret CRON inválido",
    };
  }

  try {
    await Promise.race([
      processarFalhasComErroAlto(),
      new Promise<never>((_, reject) =>
        setTimeout(()