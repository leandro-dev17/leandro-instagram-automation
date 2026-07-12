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
    const result = await Promise.race<Array<FalhaRegistro>>([
      sql<Array<FalhaRegistro>>`
        INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
        RETURNING id, agente, erro, resolvido, criado_em
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (Array.isArray(result) && result.length > 0) {
      return result[0];
    }

    return null;
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
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
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function marcarFalhaResolvida(falhaId: number): Promise<boolean> {
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
    console.error("Erro ao marcar falha como resolvida:", error);
    return false;
  }
}

export async function escalarFalha(falhaId: number, agente: string): Promise<void> {
  try {
    const falha = await sql<Array<FalhaRegistro>>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE id = ${falhaId}
    `;

    if (!Array.isArray(falha) || falha.length === 0) {
      throw new Error("Falha não encontrada");
    }

    const falhaData = falha[0];
    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(especialista || agente);

    let destinatario = especialista;
    let nivel = "Especialista";

    if (falhaData.erro.includes("crítico") || falhaData.erro.includes("timeout")) {
      destinatario = gerente;
      nivel = "Gerente";
    }

    await enviarTelegram(
      `🚨 <b>Escalação de Falha - ${nivel}</b>\n` +
      `ID: ${falhaId}\n` +
      `Agente: ${agente}\n` +
      `Erro: ${falhaData.erro}\n` +
      `Responsável: ${destinatario}\n`
    );
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function processarFalhasComRetry(
  maxTentativas: number = 3
): Promise<void> {
  try {
    const falhas = await obterFalhasNaoResolvidas();

    for (const falha of falhas) {
      let tentativa = 0;

      while (tentativa < maxTentativas) {
        try {
          if (falha.agente === "webhook_mp_valida_assinatura") {
            const resultado = validarAssinaturaMercadoPago(falha.erro);
            if ((await resultado).valid) {
              await marcarFalhaResolvida(falha.id);
              break;
            }
          }

          tentativa++;

          if (tentativa >= maxTentativas) {
            await escalarFalha(falha.id, falha.agente);
          } else {
            await new Promise((resolve) => setTimeout(resolve, 1000 * tentativa));
          }
        } catch (error) {
          tentativa++;
          if (tentativa >= maxTentativas) {
            await escalarFalha(falha.id, falha.agente);
          }
        }
      }
    }
  } catch (error) {
    console.error("Erro ao processar falhas com retry:", error);
  }
}

export async function verificarSaudeAgentes(): Promise<{
  agentes: Array<{
    nome: string;
    falhas_recentes: number;
    taxa_erro: number;
    status: "saudável" | "alerta" | "crítico";
  }>;
}> {
  try {
    const result = await Promise.race<
      Array<{
        agente: string;
        total: number;
      }>
    >([
      sql<
        Array<{
          agente: string;
          total: number;
        }>
      >`
        SELECT agente, COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        GROUP BY agente
        ORDER BY total DESC
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!Array.isArray(result)) {
      return { agentes: [] };
    }

    const agentes = result.map((item) => {
      const taxa_erro = (item.total / 100) * 100;

      let status: "saudável" | "alerta" | "crítico" = "saudável";
      if (taxa_erro > 25) {
        status = "alerta";
      }
      if (taxa_erro > 36) {
        status = "crítico";
      }

      return {
        nome: item.agente,
        falhas_recentes: item.total,
        taxa_erro,
        status,
      };
    });

    const temCritico = agentes.some((a) => a.status === "crítico");

    if (temCritico) {
      await enviarTelegram(
        `🚨 <b>Status Crítico Detectado</b>\n` +
        agentes
          .filter((a) => a.status === "crítico")
          .map((a) => `• ${a.nome}: ${a.taxa_erro.toFixed(1)}% de erro (${a.falhas_recentes} falhas)`)
          .join("\n")
      );
    }

    return { agentes };
  } catch (error) {
    console.error("Erro ao verificar saúde dos agentes:", error);
    return { agentes: [] };