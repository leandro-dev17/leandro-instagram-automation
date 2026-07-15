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
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length === 0) {
      return;
    }

    const idsRemover = falhasAntiga.map((f) => f.id);

    await Promise.race([
      sql`
        DELETE FROM falhas_agentes
        WHERE id = ANY(${idsRemover})
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    console.log(`Limpeza: ${idsRemover.length} falhas antigas removidas`);
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function verificarFalhasAbertas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql`
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
    console.error("Erro ao verificar falhas abertas:", error);
    return [];
  }
}

export async function marcarFalhaResolvida(falhaId: number): Promise<void> {
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
  } catch (error) {
    console.error("Erro ao marcar falha resolvida:", error);
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  totalAberto: number;
  totalResolvidoHoje: number;
  taxaErro: number;
}> {
  try {
    const resultado = await Promise.race<Array<{ total: number; resolvido: boolean }>>(
      [
        sql`
          SELECT COUNT(*) as total, resolvido
          FROM falhas_agentes
          WHERE criado_em > NOW() - INTERVAL '24 hours'
          GROUP BY resolvido
        `,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]
    );

    const totalAberto = resultado.find((r) => !r.resolvido)?.total || 0;
    const totalResolvidoHoje = resultado.find((r) => r.resolvido)?.total || 0;
    const totalFalhas = totalAberto + totalResolvidoHoje;
    const taxaErro = totalFalhas > 0 ? (totalAberto / totalFalhas) * 100 : 0;

    return {
      totalAberto,
      totalResolvidoHoje,
      taxaErro,
    };
  } catch (error) {
    console.error("Erro ao obter estatísticas de falhas:", error);
    return {
      totalAberto: 0,
      totalResolvidoHoje: 0,
      taxaErro: 0,
    };
  }
}

export async function processarFalhaWebhookMercadoPago(
  payload: unknown,
  statusCode: number
): Promise<void> {
  try {
    const validacao = await validarAssinaturaMercadoPago(payload);

    if (!validacao.valid) {
      await registrarFalha(
        "webhook_mp_valida_assinatura",
        `Validação falhou: ${validacao.message}`,
        {
          statusCode,
          payloadRecebido: payload,
          statusCodeValidacao: validacao.statusCode,
        }
      );
      return;
    }

    console.log("Webhook MercadoPago processado com sucesso");
  } catch (error) {
    await registrarFalha(
      "webhook_mp_processa",
      `Erro ao processar webhook: ${error instanceof Error ? error.message : "Desconhecido"}`,
      {
        statusCode,
        error: error instanceof Error ? error.message : "Desconhecido",
      }
    );
  }
}

export async function executarVerificacaoFalhas(): Promise<void> {
  try {
    const falhasAbertas = await verificarFalhasAbertas();
    const stats = await obterEstatisticasFalhas();

    if (stats.taxaErro > 30) {
      await enviarTelegram(
        `⚠️ <b>Taxa de Erro Elevada Detectada</b>\n` +
        `Taxa: ${stats.taxaErro.toFixed(2)}%\n` +
        `Falhas Abertas: ${stats.totalAberto}\n` +
        `Resolvidas Hoje: ${stats.totalResolvidoHoje}\n`,
        []
      );
    }

    if (falhasAbertas.length > LIMITE_BACKLOG) {
      await limparBacklogFalhas();
    }
  } catch (error) {
    console.error("Erro ao executar verificação de falhas:", error);
  }
}