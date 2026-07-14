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
        SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        OR resolvido = TRUE
        LIMIT 500
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length > 0) {
      const ids = falhasAntiga.map(f => f.id);
      await sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${ids})
      `;

      console.log(`Limpas ${falhasAntiga.length} falhas antigas`);
    }

    const totalFalhas = await Promise.race<FalhaResult[]>([
      sql`SELECT COUNT(*) as total FROM falhas_agentes WHERE resolvido = FALSE`,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = totalFalhas[0]?.total || 0;
    
    if (total > LIMITE_BACKLOG) {
      await enviarTelegram(
        `⚠️ <b>Backlog Excessivo</b>\n` +
        `Total de falhas não resolvidas: ${total}\n` +
        `Limite: ${LIMITE_BACKLOG}\n`,
        []
      );
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function analisarFalhaPorEspecialista(agente: string): Promise<void> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql`
        SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes
        WHERE agente = ${agente} AND resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT ${LIMITE_ESPECIALISTA}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhas.length >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `⚠️ <b>Limite de Falhas Atingido</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas: ${falhas.length}\n` +
        `Especialista responsável: ${especialista}\n`,
        [especialista]
      );
    }
  } catch (error) {
    console.error("Erro ao analisar falhas por especialista:", error);
  }
}

export async function analisarFalhaPorGerente(agente: string): Promise<void> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql`
        SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes
        WHERE agente = ${agente} AND resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT ${LIMITE_GERENTE}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhas.length >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      await enviarTelegram(
        `🔴 <b>Limite Crítico de Falhas</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas: ${falhas.length}\n` +
        `Gerente responsável: ${gerente}\n`,
        [gerente]
      );
    }
  } catch (error) {
    console.error("Erro ao analisar falhas por gerente:", error);
  }
}

export async function marcarFalhaResolvida(falhaId: number): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, criado_em = NOW()
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

export async function obterFalhasNaoResolvidas(limite: number = 10): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql`
        SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT ${limite}
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

export async function verificarWebhookMercadoPago(
  payload: unknown
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  try {
    if (!payload) {
      await registrarFalha(
        "webhook_mp_valida_assinatura",
        "Payload vazio ou não fornecido",
        { receivedPayload: payload }
      );
      return {
        valid: false,
        statusCode: 400,
        message: "Payload inválido ou vazio",
      };
    }

    const validacao = await validarAssinaturaMercadoPago(payload);

    if (!validacao.valid) {
      await registrarFalha(
        "webhook_mp_valida_assinatura",
        validacao.message,
        { receivedPayload: payload, statusCode: validacao.statusCode }
      );
    }

    return validacao;
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Erro desconhecido";
    await registrarFalha(
      "webhook_mp_valida_assinatura",
      `Exceção durante validação: ${mensagemErro}`,
      { error: mensagemErro }
    );
    return {
      valid: false,
      statusCode: 400,
      message: mensagemErro,
    };
  }
}

export async function executarAgenteFalha(): Promise<void> {
  try {
    if (!CRON_SECRET) {
      console.error("CRON_SECRET não configurado");
      return;
    }

    await Promise.race([
      (async () => {
        await limparBacklogFalhas();
      })(),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);
  } catch (error) {
    console.error("Erro ao executar agente de falha:", error);
    await registrarFalha(
      "agente_falha_execucao",
      `Erro crítico: ${error instanceof Error ? error.message : "Desconhecido"}`,
      { error }
    );
  }
}