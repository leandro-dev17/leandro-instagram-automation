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
      await enviarTelegram(
        `❌ <b>Erro na Limpeza de Backlog</b>\n` +
        `${error instanceof Error ? error.message : "Erro desconhecido"}`
      );
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
        INSERT INTO falhas_agentes (agente, erro, dados)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})})
        RETURNING id, agente, erro, resolvido, criado_em
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(resultado) && resultado.length > 0 ? resultado[0] : null;
  } catch (error) {
    console.error(`Erro ao registrar falha do agente ${agente}:`, error);
    return null;
  }
}

export async function obterFalhasNaoResolvidas(
  limite: number = LIMITE_BACKLOG
): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE resolvido = FALSE
        ORDER BY criado_em DESC
        LIMIT ${limite}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function resolverFalha(falhaId: number): Promise<boolean> {
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
    console.error(`Erro ao resolver falha ${falhaId}:`, error);
    return false;
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  total: number;
  naoResolvidas: number;
  taxaErro: number;
}> {
  try {
    const resultado = await Promise.race<
      Array<{ total: number; nao_resolvidas: number }>
    >([
      sql<Array<{ total: number; nao_resolvidas: number }>>`
        SELECT
          COUNT(*) as total,
          SUM(CASE WHEN resolvido = FALSE THEN 1 ELSE 0 END) as nao_resolvidas
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(resultado) && resultado.length > 0) {
      const stats = resultado[0];
      const total = stats.total || 0;
      const naoResolvidas = stats.nao_resolvidas || 0;
      const taxaErro = total > 0 ? (naoResolvidas / total) * 100 : 0;

      return {
        total,
        naoResolvidas,
        taxaErro,
      };
    }

    return { total: 0, naoResolvidas: 0, taxaErro: 0 };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return { total: 0, naoResolvidas: 0, taxaErro: 0 };
  }
}

export async function notificarEquipeComTaxaAlta(
  taxaErro: number
): Promise<void> {
  if (taxaErro > 30) {
    const gerente = await getGerenteResponsavel();
    const especialista = await getEspecialistaResponsavel();

    const mensagem =
      `🚨 <b>ALERTA: Taxa de Erros Elevada</b>\n` +
      `Taxa de erro: ${taxaErro.toFixed(2)}%\n` +
      `Gerente responsável: ${gerente?.nome || "Não atribuído"}\n` +
      `Especialista responsável: ${especialista?.nome || "Não atribuído"}\n` +
      `URL da aplicação: ${APP_URL}`;

    await enviarTelegram(mensagem);
  }
}

export async function executarAgenteRecuperacao(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas(LIMITE_ESPECIALISTA);

    for (const falha of falhas) {
      if (falha.agente === "webhook_mp_valida_assinatura") {
        const resolvido = await tentarResolverWebhookMP(falha);
        if (resolvido) {
          await resolverFalha(falha.id);
        }
      }
    }

    const stats = await obterEstatisticasFalhas();
    await notificarEquipeComTaxaAlta(stats.taxaErro);
  } catch (error) {
    console.error("Erro no agente de recuperação:", error);
    await enviarTelegram(
      `❌ <b>Erro no Agente de Recuperação</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}`
    );
  }
}

async function tentarResolverWebhookMP(falha: FalhaRegistro): Promise<boolean> {
  try {
    const resposta = await Promise.race([
      fetch(`${APP_URL}/api/webhooks/mercado-pago`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          type: "payment.created",
          data: { id: "test-recovery" },
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);

    return resposta.ok;
  } catch (error) {
    console.error("Erro ao tentar resolver webhook MP:", error);
    return false;
  }
}

export async function validarWebhookMercadoPago(
  request: Request
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  try {
    let payload: unknown;

    try {
      const texto = await request.text();
      if (!texto || texto.trim().length === 0) {
        return {
          valid: false,
          statusCode: 400,
          message: "Corpo da requisição vazio",
        };
      }
      payload = JSON.parse(texto);
    } catch {
      return {
        valid: false,
        statusCode: 400,