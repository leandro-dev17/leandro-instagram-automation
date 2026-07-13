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
        AND resolvido = TRUE
        LIMIT 500
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length > 0) {
      const ids = falhasAntiga.map((f) => f.id);
      await sql`DELETE FROM falhas_agentes WHERE id = ANY(${ids})`;

      await enviarTelegram(
        `🧹 <b>Limpeza de Backlog Realizada</b>\n` +
        `Registros deletados: ${falhasAntiga.length}\n` +
        `Período: ${TEMPO_RETENCAO_FALHAS} horas\n`,
        []
      );
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function verificarBacklogExcessivo(): Promise<void> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = resultado[0]?.total || 0;

    if (total > LIMITE_BACKLOG) {
      await enviarTelegram(
        `⚠️ <b>Backlog Excessivo Detectado</b>\n` +
        `Total de falhas abertas: ${total}\n` +
        `Limite: ${LIMITE_BACKLOG}\n` +
        `Status: CRÍTICO\n`,
        []
      );

      await registrarFalha(
        "verificador-backlog",
        `Backlog excessivo: ${total} falhas abertas`,
        { limite: LIMITE_BACKLOG, atual: total }
      );
    }
  } catch (error) {
    console.error("Erro ao verificar backlog:", error);
  }
}

export async function escalarFalhasNaoResolvidas(): Promise<void> {
  try {
    const falhasEspecialista = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        AND criado_em < NOW() - INTERVAL '${LIMITE_ESPECIALISTA} hours'
        LIMIT 100
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    for (const falha of falhasEspecialista) {
      const especialista = await getEspecialistaResponsavel(falha.agente);
      await enviarTelegram(
        `⏰ <b>Falha Aguardando Há ${LIMITE_ESPECIALISTA}h</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Escalado para: ${especialista}\n`,
        [especialista]
      );
    }

    const falhasGerente = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        AND criado_em < NOW() - INTERVAL '${LIMITE_GERENTE} hours'
        LIMIT 100
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    for (const falha of falhasGerente) {
      const gerente = await getGerenteResponsavel(falha.agente);
      await enviarTelegram(
        `🔴 <b>Falha Crítica Aguardando Há ${LIMITE_GERENTE}h</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Escalado para: ${gerente}\n`,
        [gerente]
      );
    }
  } catch (error) {
    console.error("Erro ao escalar falhas:", error);
  }
}

export async function marcarFalhaResolvida(falhaId: number): Promise<void> {
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
    console.error("Erro ao marcar falha como resolvida:", error);
  }
}

export async function obterFalhasAbertas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT 500
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas abertas:", error);
    return [];
  }
}

export async function gerarRelatorioDiario(): Promise<void> {
  try {
    const falhasAbertas = await Promise.race<FalhaResult[]>([
      sql<FalhaResult>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const falhasResolvidasHoje = await Promise.race<FalhaResult[]>([
      sql<FalhaResult>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE resolvido = TRUE
        AND atualizado_em >= NOW() - INTERVAL '24 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalAberto = falhasAbertas[0]?.total || 0;
    const totalResolvido = falhasResolvidasHoje[0]?.total || 0;

    await enviarTelegram(
      `📊 <b>Relatório Diário de Falhas</b>\n` +
      `Falhas abertas: ${totalAberto}\n` +
      `Falhas resolvidas (24h): ${totalResolvido}\n` +
      `Status: ${totalAberto > LIMITE_BACKLOG ? "🔴 CRÍTICO" : "🟢 NORMAL"}\n`,
      []