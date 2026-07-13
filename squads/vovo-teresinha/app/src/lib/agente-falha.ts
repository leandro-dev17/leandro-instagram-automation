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
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        AND resolvido = FALSE
        LIMIT 500
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length === 0) {
      return;
    }

    const idsParaLimpar = falhasAntiga.map((f) => f.id);

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, atualizado_em = NOW()
        WHERE id = ANY(${idsParaLimpar})
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `🧹 <b>Limpeza de Backlog</b>\n` +
      `Falhas antigas marcadas como resolvidas: ${falhasAntiga.length}\n` +
      `IDs: ${idsParaLimpar.join(", ")}`
    );
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function verificarBacklogExcessivo(): Promise<void> {
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

    const totalFalhas = resultado[0]?.total || 0;

    if (totalFalhas > LIMITE_BACKLOG) {
      await enviarTelegram(
        `⚠️ <b>Alerta: Backlog Excessivo</b>\n` +
        `Total de falhas não resolvidas: ${totalFalhas}\n` +
        `Limite: ${LIMITE_BACKLOG}\n` +
        `Ação recomendada: Executar limpeza de backlog`,
        ["gerente_responsavel"]
      );

      await limparBacklogFalhas();
    }
  } catch (error) {
    console.error("Erro ao verificar backlog excessivo:", error);
  }
}

export async function atribuirFalhaEspecialista(
  falhaId: number,
  agenteNome: string
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agenteNome);

    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET especialista_atribuido = ${especialista}, atualizado_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    await enviarTelegram(
      `📋 <b>Falha Atribuída a Especialista</b>\n` +
      `ID da Falha: ${falhaId}\n` +
      `Especialista: ${especialista}\n` +
      `Agente: ${agenteNome}`
    );
  } catch (error) {
    console.error("Erro ao atribuir falha a especialista:", error);
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    await Promise.race([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}, atualizado_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const falha = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falha.length > 0) {
      await enviarTelegram(
        `✅ <b>Falha Resolvida</b>\n` +
        `ID: ${falhaId}\n` +
        `Agente: ${falha[0].agente}\n` +
        `Resolução: ${resolucao}`
      );
    }
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
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
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function validarWebhookMercadoPago(
  payload: unknown
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  const validacao = await validarAssinaturaMercadoPago(payload);

  if (!validacao.valid) {
    await registrarFalha(
      "webhook_mp_valida_assinatura",
      `Validação falhou: ${validacao.message}`,
      {
        payload,
        statusCode: validacao.statusCode,
      }
    );
  }

  return validacao;
}

export async function processarWebhookMercadoPago(
  payload: unknown
): Promise<{ success: boolean; statusCode: number; message: string }> {
  const validacao = await validarWebhookMercadoPago(payload);

  if (!validacao.valid) {
    return {
      success: false,
      statusCode: validacao.statusCode,
      message: validacao.message,
    };
  }

  try {
    const webhookPayload = payload as WebhookMercadoPagoPayload;

    await Promise.race([
      sql`
        INSERT INTO webhooks_processados (tipo, dados_originais, processado_em)
        VALUES ('mercado_pago', ${JSON.stringify(webhookPayload)}, NOW())
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return {
      success: true,
      statusCode: 200,
      message: "Webhook processado com sucesso",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Desconhecido";

    await registrarFalha(