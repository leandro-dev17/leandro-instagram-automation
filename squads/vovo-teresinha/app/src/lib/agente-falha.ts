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
      await enviarTelegram(
        `❌ <b>Erro ao Limpar Backlog</b>\n` +
        `Erro: ${error instanceof Error ? error.message : String(error)}\n`
      );
    }
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<FalhaRegistro | null> {
  try {
    const resultado = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
        RETURNING id, agente, erro, resolvido, criado_em
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(resultado) && resultado.length > 0 ? resultado[0] : null;
  } catch (error) {
    console.error("[registrarFalhaAgente] Erro:", error);
    return null;
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
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
    console.error("[obterFalhasNaoResolvidas] Erro:", error);
    return [];
  }
}

export async function resolverFalha(falhaId: number): Promise<boolean> {
  try {
    await Promise.race<void>([
      sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolvido_em = NOW()
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return true;
  } catch (error) {
    console.error("[resolverFalha] Erro:", error);
    return false;
  }
}

export async function notificarEquipe(
  falha: FalhaRegistro,
  escalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    let destinatario = "";
    let nivel = "";

    if (escalacao === "especialista") {
      destinatario = await getEspecialistaResponsavel(falha.agente);
      nivel = "🔧 Especialista";
    } else if (escalacao === "gerente") {
      destinatario = await getGerenteResponsavel(falha.agente);
      nivel = "👔 Gerente";
    } else {
      nivel = "🤖 Claude IA";
    }

    const mensagem =
      `${nivel} - <b>Falha Detectada</b>\n` +
      `Agente: ${falha.agente}\n` +
      `Erro: ${falha.erro}\n` +
      `ID: ${falha.id}\n` +
      `Criado em: ${new Date(falha.criado_em).toLocaleString("pt-BR")}\n`;

    if (destinatario) {
      await enviarTelegram(mensagem + `Para: @${destinatario}`);
    } else {
      await enviarTelegram(mensagem);
    }
  } catch (error) {
    console.error("[notificarEquipe] Erro:", error);
  }
}

export async function analisarFalhasRecentes(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    if (falhas.length === 0) {
      return;
    }

    const agrupadosPorAgente: Record<string, number> = {};

    for (const falha of falhas) {
      agrupadosPorAgente[falha.agente] = (agrupadosPorAgente[falha.agente] || 0) + 1;
    }

    for (const [agente, contador] of Object.entries(agrupadosPorAgente)) {
      if (contador >= LIMITE_ESPECIALISTA && contador < LIMITE_GERENTE) {
        await notificarEquipe(falhas[0], "especialista");
      } else if (contador >= LIMITE_GERENTE && contador < LIMITE_CLAUDE) {
        await notificarEquipe(falhas[0], "gerente");
      } else if (contador >= LIMITE_CLAUDE) {
        await notificarEquipe(falhas[0], "claude");
      }
    }

    await enviarTelegram(
      `📊 <b>Resumo de Falhas</b>\n` +
      `Total de agentes afetados: ${Object.keys(agrupadosPorAgente).length}\n` +
      `Total de falhas: ${falhas.length}\n`
    );
  } catch (error) {
    console.error("[analisarFalhasRecentes] Erro:", error);
  }
}

export async function validarWebhookMercadoPago(
  payload: unknown,
  signature?: string
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  try {
    if (payload === null || payload === undefined) {
      await registrarFalhaAgente(
        "webhook_mp_valida_assinatura",
        "Payload vazio ou nulo",
        { signature }
      );
      return {
        valid: false,
        statusCode: 400,
        message: "Payload inválido ou vazio",
      };
    }

    if (typeof payload !== "object") {
      await registrarFalhaAgente(
        "webhook_mp_valida_assinatura",
        "Payload não é um objeto",
        { type: typeof payload }
      );
      return {
        valid: false,
        statusCode: 400,
        message: "Payload deve ser um objeto",
      };
    }

    const webhookPayload = payload as WebhookMercadoPagoPayload;

    if (!webhookPayload.type || !webhookPayload.data?.id) {
      await registrarFalhaAgente(
        "webhook_mp_valida_assinatura",
        "Campos obrigatórios ausentes",
        { type: webhookPayload.type, dataId: webhookPayload.data?.id }
      );
      return {
        valid: false,
        statusCode: 400,
        message: "Campos obrigatórios ausentes: type ou data.id",
      };
    }

    if (!signature) {
      await registrarFalhaAgente(
        "webhook_mp_valida_assinatura",
        "Assinatura ausente no header",
        { type: webhookPayload.type }
      );
      return {
        valid: false,
        statusCode: 401,
        message: "Assinatura não fornecida",
      };
    }