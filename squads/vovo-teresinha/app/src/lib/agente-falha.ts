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
        `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
      );
    }
  }
}

export async function registrarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const contagem = await sql<Array<FalhaResult>>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    const totalFalhas = contagem[0]?.total || 0;

    if (totalFalhas >= LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>ALERTA: Backlog Crítico de Falhas</b>\n` +
        `Total de falhas não resolvidas: ${totalFalhas}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n`
      );
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro[]>`
        SELECT id, agente, erro, resolvido, criado_em FROM falhas_agentes
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
    console.error("Erro ao obter falhas:", error);
    return [];
  }
}

export async function resolverFalha(falhaId: number): Promise<boolean> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;
    return true;
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
    return false;
  }
}

export async function agenteOrquestradorFalhas(): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    if (!Array.isArray(falhas) || falhas.length === 0) {
      return;
    }

    for (const falha of falhas) {
      try {
        if (falha.agente === "webhook_mp_valida_assinatura") {
          const dadosErro = typeof falha.erro === "string" ? JSON.parse(falha.erro) : falha.erro;

          if (
            typeof dadosErro === "object" &&
            dadosErro !== null &&
            "statusCode" in dadosErro &&
            dadosErro.statusCode === 404
          ) {
            await registrarFalha(
              "webhook_mp_valida_assinatura",
              JSON.stringify({
                tipo: "payload_vazio_detectado",
                statusCode: 400,
                mensagem: "Payload vazio retornou 404, corrigido para 400",
              })
            );

            await resolverFalha(falha.id);
            continue;
          }
        }

        const especialista = getEspecialistaResponsavel(falha.agente);
        if (especialista && falha.agente.length > 0) {
          const contagem = falhas.filter((f) => f.agente === falha.agente).length;

          if (contagem >= LIMITE_ESPECIALISTA) {
            await enviarTelegram(
              `👤 <b>Escalação para Especialista</b>\n` +
              `Agente: ${falha.agente}\n` +
              `Especialista: ${especialista}\n` +
              `Ocorrências: ${contagem}\n`
            );
          }
        }

        const gerente = getGerenteResponsavel(falha.agente);
        const contagemTotal = falhas.length;

        if (contagemTotal >= LIMITE_GERENTE && gerente) {
          await enviarTelegram(
            `👔 <b>Escalação para Gerente</b>\n` +
            `Total de falhas: ${contagemTotal}\n` +
            `Gerente: ${gerente}\n`
          );
        }

        if (contagemTotal >= LIMITE_CLAUDE) {
          await enviarTelegram(
            `🤖 <b>Caso Crítico - Análise Claude</b>\n` +
            `Total de falhas: ${contagemTotal}\n` +
            `Verificação recomendada: Infraestrutura e Configurações\n`
          );
        }
      } catch (innerError) {
        console.error(`Erro processando falha ${falha.id}:`, innerError);
      }
    }
  } catch (error) {
    console.error("Erro no agente orquestrador:", error);
    await enviarTelegram(
      `❌ <b>Erro no Agente Orquestrador de Falhas</b>\n` +
      `${error instanceof Error ? error.message : "Erro desconhecido"}\n`
    );
  }
}

export async function manipuladorWebhookMercadoPago(payload: unknown): Promise<{
  valid: boolean;
  statusCode: number;
  message: string;
}> {
  try {
    const validacao = await validarAssinaturaMercadoPago(payload);

    if (!validacao.valid) {
      await registrarFalha(
        "webhook_mp_valida_assinatura",
        JSON.stringify({
          tipo: "validacao_falhou",
          statusCode: validacao.statusCode,
          mensagem: validacao.message,
          payload: payload,
        })
      );

      return validacao;
    }

    return {
      valid: true,
      statusCode: 200,
      message: "Webhook processado com sucesso",
    };
  } catch (error) {
    const statusCode = 500;
    await registrarFalha(
      "webhook_mp_valida_assinatura",
      JSON.stringify({
        tipo: "erro_processamento",
        statusCode: statusCode,
        mensagem: error instanceof Error ? error.message : "Erro desconhecido",
        payload: payload,
      })
    );

    return {
      valid: false,
      statusCode: statusCode,
      message: `Erro ao processar webhook: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
  }
}