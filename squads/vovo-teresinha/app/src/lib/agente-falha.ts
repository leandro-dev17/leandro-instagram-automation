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
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
        AND resolvido = TRUE
        LIMIT ${LIMITE_BACKLOG}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (falhasAntiga.length > 0) {
      const ids = falhasAntiga.map((f) => f.id);
      await sql`DELETE FROM falhas_agentes WHERE id = ANY(${ids})`;
    }
  } catch (error) {
    console.error("Erro ao limpar backlog de falhas:", error);
  }
}

export async function escalarFalha(
  falhaId: number,
  nivelEscalacao: "especialista" | "gerente" | "claude"
): Promise<void> {
  try {
    const falha = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
        SELECT id, agente, erro, resolvido, criado_em
        FROM falhas_agentes
        WHERE id = ${falhaId}
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    if (!falha || falha.length === 0) {
      throw new Error(`Falha ${falhaId} não encontrada`);
    }

    const { agente, erro } = falha[0];
    let mensagem = "";

    if (nivelEscalacao === "especialista") {
      const especialista = await getEspecialistaResponsavel(agente);
      mensagem = `⚠️ <b>Escalação para Especialista</b>\nAgente: ${agente}\nErro: ${erro}\nResponsável: ${especialista}`;
      await enviarTelegram(mensagem, [especialista]);
    } else if (nivelEscalacao === "gerente") {
      const gerente = await getGerenteResponsavel(agente);
      mensagem = `⚠️ <b>Escalação para Gerente</b>\nAgente: ${agente}\nErro: ${erro}\nResponsável: ${gerente}`;
      await enviarTelegram(mensagem, [gerente]);
    } else if (nivelEscalacao === "claude") {
      mensagem = `⚠️ <b>Escalação para Análise IA</b>\nAgente: ${agente}\nErro: ${erro}`;
      await enviarTelegram(mensagem, ["claude"]);
    }

    await sql`
      UPDATE falhas_agentes
      SET resolvido = FALSE
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    console.error("Erro ao escalar falha:", error);
  }
}

export async function resolverFalha(falhaId: number): Promise<void> {
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
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await Promise.race<FalhaRegistro[]>([
      sql<FalhaRegistro>`
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

export async function verificarTaxaErro(): Promise<number> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    return resultado.length > 0 ? resultado[0].total : 0;
  } catch (error) {
    console.error("Erro ao verificar taxa de erro:", error);
    return 0;
  }
}

export async function criarAlertaAutomatico(): Promise<void> {
  try {
    const taxaErro = await verificarTaxaErro();

    if (taxaErro > 30) {
      const falhas = await obterFalhasNaoResolvidas();
      const agentesMaisFrequentes = Object.entries(
        falhas.reduce(
          (acc, f) => {
            acc[f.agente] = (acc[f.agente] || 0) + 1;
            return acc;
          },
          {} as Record<string, number>
        )
      )
        .sort(([, a], [, b]) => b - a)
        .slice(0, 3)
        .map(([agente, count]) => `${agente} (${count})`);

      const mensagem = `🚨 <b>ALERTA CRÍTICO</b>\nTaxa de erros: ${taxaErro}%\nAgentes mais afetados:\n${agentesMaisFrequentes.join("\n")}`;
      await enviarTelegram(mensagem, ["gerente_operacional"]);
    }
  } catch (error) {
    console.error("Erro ao criar alerta automático:", error);
  }
}