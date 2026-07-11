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
        `Será retentado na próxima execução.\n`
      );
    } else {
      console.error("Erro ao limpar backlog:", error);
    }
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
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    const contagem = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    const totalFalhas = Array.isArray(contagem) && contagem.length > 0 ? contagem[0].total : 0;

    if (totalFalhas > LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Limite de Backlog Excedido</b>\n` +
        `Falhas não resolvidas: ${totalFalhas}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}`
      );
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function processarFalhas(): Promise<void> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em ASC
        LIMIT 10
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    for (const falha of falhas) {
      await escalarFalha(falha);
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      await enviarTelegram(
        `⚠️ <b>Timeout ao Processar Falhas</b>\n` +
        `Será retentado na próxima execução.\n`
      );
    } else {
      console.error("Erro ao processar falhas:", error);
    }
  }
}

export async function escalarFalha(falha: FalhaRegistro): Promise<void> {
  try {
    const tentativas = await sql<Array<{ count: number }>>`
      SELECT COUNT(*) as count FROM falhas_agentes
      WHERE id = ${falha.id}
    `;

    const tentativaAtual = Array.isArray(tentativas) && tentativas.length > 0 ? tentativas[0].count : 0;

    if (tentativaAtual < LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(falha.agente);
      await enviarTelegram(
        `👨‍💼 <b>Escalação para Especialista</b>\n` +
        `Responsável: ${especialista}\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}`
      );
    } else if (tentativaAtual < LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(falha.agente);
      await enviarTelegram(
        `👔 <b>Escalação para Gerente</b>\n` +
        `Responsável: ${gerente}\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}`
      );
    } else if (tentativaAtual < LIMITE_CLAUDE) {
      await enviarTelegram(
        `🤖 <b>Escalação para Claude</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Tentativas: ${tentativaAtual}`
      );
    } else {
      await sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE
        WHERE id = ${falha.id}
      `;

      await enviarTelegram(
        `❌ <b>Falha Não Resolvida - Arquivo</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Tentativas: ${tentativaAtual}`
      );
    }
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function validarWebhook(
  payload: WebhookValidacaoPayload
): Promise<{ valid: boolean; statusCode: number }> {
  try {
    if (!payload.agente || !payload.erro) {
      return {
        valid: false,
        statusCode: 400,
      };
    }

    if (payload.statusCode && (payload.statusCode === 401 || payload.statusCode === 403)) {
      return {
        valid: false,
        statusCode: payload.statusCode,
      };
    }

    return {
      valid: true,
      statusCode: 200,
    };
  } catch (error) {
    return {
      valid: false,
      statusCode: 400,
    };
  }
}

export async function tratarErroWebhookMP(
  payload: unknown,
  statusCode: number
): Promise<{ sucesso: boolean; codigo: number; mensagem: string }> {
  try {
    if (payload === null || payload === undefined) {
      await registrarFalha(
        "webhook_mp_valida_assinatura",
        "Payload ausente no webhook",
        { statusCode, payloadType: typeof payload }
      );
      return {
        sucesso: false,
        codigo: 400,
        mensagem: "Payload obrigatório ausente",
      };
    }

    if (typeof payload !== "object") {
      await registrarFalha(
        "webhook_mp_valida_assinatura",
        "Tipo de payload inválido",
        { statusCode, payloadType: typeof payload }
      );
      return {
        sucesso: false,
        codigo: 400,
        mensagem: "Payload deve ser um objeto",
      };
    }

    const resultado = validarAssinaturaMercadoPago(payload);
    
    return {
      sucesso: true,
      codigo: 200,
      mensagem: "Webhook processado com sucesso",
    };
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    await registrarFalha(
      "webhook_mp_valida_assinatura",
      `Erro ao processar webhook: ${mensagemErro}`,
      { statusCode, erro: mensagemErro }
    );

    return {
      sucesso: false,
      codigo: 500,
      mensagem: "Erro ao processar webhook",
    };
  }
}