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
): Promise<void> {
  try {
    const count = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    const backlogAtual = count[0]?.total || 0;

    if (backlogAtual >= LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Backlog de Falhas Crítico</b>\n` +
        `Agente: ${agente}\n` +
        `Registros pendentes: ${backlogAtual}\n`
      );
      return;
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    if (backlogAtual > LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `⚠️ <b>Falha Registrada - Especialista</b>\n` +
          `Agente: ${agente}\n` +
          `Erro: ${erro}\n` +
          `Para: ${especialista}\n`
        );
      }
    }
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao Registrar Falha</b>\n` +
      `Agente: ${agente}\n` +
      `Detalhes: ${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

export async function resolverFalha(
  falhaId: number,
  resolvidoPor: string
): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolvido_por = ${resolvidoPor}, resolvido_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}\n` +
      `Resolvido por: ${resolvidoPor}\n`
    );
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao Resolver Falha</b>\n` +
      `ID: ${falhaId}\n` +
      `Detalhes: ${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
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
        LIMIT 50
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return falhas;
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao Obter Falhas</b>\n` +
      `Detalhes: ${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
    return [];
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await sql<Array<FalhaRegistro>>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE id = ${falhaId}
    `;

    if (!falha || falha.length === 0) {
      throw new Error(`Falha com ID ${falhaId} não encontrada`);
    }

    const registro = falha[0];

    let responsavel = "Sistema";
    let mensagem = "";

    if (nivelEscalacao === "especialista") {
      responsavel = await getEspecialistaResponsavel(registro.agente);
      mensagem = `🔴 <b>Escalação para Especialista</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${registro.agente}\n` +
        `Erro: ${registro.erro}\n` +
        `Especialista: ${responsavel}\n`;
    } else if (nivelEscalacao === "gerente") {
      responsavel = await getGerenteResponsavel(registro.agente);
      mensagem = `🔴 <b>Escalação para Gerente</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${registro.agente}\n` +
        `Erro: ${registro.erro}\n` +
        `Gerente: ${responsavel}\n`;
    } else if (nivelEscalacao === "claude") {
      mensagem = `🔴 <b>Escalação para Claude (IA)</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${registro.agente}\n` +
        `Erro: ${registro.erro}\n`;
    }

    await sql`
      UPDATE falhas_agentes
      SET nivel_escalacao = ${nivelEscalacao}, escalado_em = NOW()
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(mensagem);
  } catch (error) {
    await enviarTelegram(
      `❌ <b>Erro ao Escalar Falha</b>\n` +
      `ID: ${falhaId}\n` +
      `Detalhes: ${error instanceof Error ? error.message : "Desconhecido"}\n`
    );
  }
}

export async function verificarSaudeMercadoPago(): Promise<{
  status: string;
  ultimaValidacao: string;
  errosTotais24h: number;
}> {
  try {
    const erros = await Promise.race<Array<FalhaResult>>([
      sql<Array<FalhaResult>>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE agente = 'webhook_mp_valida_assinatura'
        AND criado_em > NOW() - INTERVAL '24 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const errosTotais = erros[0]?.total || 0;
    const taxa = errosTotais > 0 ? (errosTotais / 100) * 100 : 0;

    if (taxa > 30) {
      await enviarTelegram(
        `🚨 <b>Taxa de Erro Alto - Mercado Pago</b>\n` +
        `Taxa: ${taxa.toFixed(2)}%\n` +
        `Erros nas últimas 24h: ${errosTotais}\n` +
        `