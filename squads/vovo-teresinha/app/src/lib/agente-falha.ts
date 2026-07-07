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
        `Erro: ${error instanceof Error ? error.message : "Desconhecido"}\n`
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
    const contagem = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const totalAberto = contagem[0]?.total || 0;

    if (totalAberto >= LIMITE_BACKLOG) {
      await enviarTelegram(
        `🚨 <b>Backlog Crítico Detectado</b>\n` +
        `Agente: ${agente}\n` +
        `Falhas abertas: ${totalAberto}\n` +
        `Limite: ${LIMITE_BACKLOG}\n`
      );
      return;
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, false, NOW())
    `;

    if (totalAberto > LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `⚠️ <b>Falha Registrada - Escalada Especialista</b>\n` +
          `Agente: ${agente}\n` +
          `Especialista: ${especialista}\n` +
          `Erro: ${erro}\n`
        );
      }
    }

    if (totalAberto > LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente) {
        await enviarTelegram(
          `🔴 <b>Falha Crítica - Escalada Gerente</b>\n` +
          `Agente: ${agente}\n` +
          `Gerente: ${gerente}\n` +
          `Erro: ${erro}\n`
        );
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message === "DB_TIMEOUT") {
      console.error(`Timeout ao registrar falha para agente ${agente}`);
    } else {
      console.error(`Erro ao registrar falha: ${error instanceof Error ? error.message : "Desconhecido"}`);
    }
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<boolean> {
  try {
    const resultado = await Promise.race<Array<{ id: number }>>([
      sql<Array<{ id: number }>>`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}, resolvido_em = NOW()
        WHERE id = ${falhaId}
        RETURNING id
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return Array.isArray(resultado) && resultado.length > 0;
  } catch (error) {
    console.error(`Erro ao resolver falha ${falhaId}: ${error instanceof Error ? error.message : "Desconhecido"}`);
    return false;
  }
}

export async function obterFalhasAbertas(): Promise<FalhaRegistro[]> {
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

    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error(`Erro ao obter falhas abertas: ${error instanceof Error ? error.message : "Desconhecido"}`);
    return [];
  }
}

export async function analisarFalhaComClaude(
  falhaId: number,
  erro: string
): Promise<string> {
  try {
    const response = await Promise.race<Response>([
      fetch(`${APP_URL}/api/claude-analise`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-cron-secret": CRON_SECRET || "",
        },
        body: JSON.stringify({ falhaId, erro }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);

    if (!response.ok) {
      throw new Error(`API retornou ${response.status}`);
    }

    const data = await response.json() as { analise: string };
    return data.analise || "Análise indisponível";
  } catch (error) {
    const mensagemErro = error instanceof Error ? error.message : "Desconhecido";
    return `Erro na análise: ${mensagemErro}`;
  }
}

export async function verificarBacklogExcessivo(): Promise<void> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total FROM falhas_agentes
        WHERE resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = resultado[0]?.total || 0;

    if (total > LIMITE_BACKLOG * 5) {
      await enviarTelegram(
        `🚨 <b>ALERTA CRÍTICO: Backlog Excessivo</b>\n` +
        `Total de falhas abertas: ${total}\n` +
        `Limite crítico: ${LIMITE_BACKLOG * 5}\n` +
        `Ação recomendada: Executar limpador-dados\n`
      );
    }
  } catch (error) {
    console.error(`Erro ao verificar backlog: ${error instanceof Error ? error.message : "Desconhecido"}`);
  }
}

export async function validarWebhookMercadoPago(
  payload: unknown
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  if (!payload) {
    return {
      valid: false,
      statusCode: 400,
      message: "Payload vazio",
    };
  }

  const resultado = await validarAssinaturaMercadoPago(payload);
  return resultado;
}