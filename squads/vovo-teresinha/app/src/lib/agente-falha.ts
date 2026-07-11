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
      console.error("Erro ao limpar backlog:", error);
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
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;

    await enviarTelegram(
      `⚠️ <b>Falha Registrada</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}\n`
    );
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
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
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;

    return true;
  } catch (error) {
    console.error("Erro ao marcar falha como resolvida:", error);
    return false;
  }
}

export async function notificarEquipeResponsavel(
  agente: string,
  erro: string,
  statusCode?: number
): Promise<void> {
  try {
    const especialista = await getEspecialistaResponsavel(agente);
    const gerente = await getGerenteResponsavel(agente);

    const mensagem = `
🚨 <b>Falha Crítica Detectada</b>
Agente: ${agente}
Erro: ${erro}
${statusCode ? `Status Code: ${statusCode}` : ""}
Especialista: @${especialista?.username || "não atribuído"}
Gerente: @${gerente?.username || "não atribuído"}
    `.trim();

    await enviarTelegram(mensagem);
  } catch (error) {
    console.error("Erro ao notificar equipe:", error);
  }
}

export async function escalonarFalha(
  falhaId: number,
  agente: string,
  erro: string
): Promise<void> {
  try {
    const falha = await sql<FalhaRegistro[]>`
      SELECT * FROM falhas_agentes WHERE id = ${falhaId}
    `;

    if (!Array.isArray(falha) || falha.length === 0) {
      return;
    }

    const tentativas = (falha[0] as FalhaRegistro & { tentativas?: number }).tentativas || 0;

    if (tentativas < LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);
      if (especialista) {
        await enviarTelegram(
          `📋 <b>Escalonamento para Especialista</b>\n` +
          `Falha ID: ${falhaId}\n` +
          `Especialista: @${especialista.username}\n` +
          `Erro: ${erro}\n`
        );
      }
    } else if (tentativas < LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);
      if (gerente) {
        await enviarTelegram(
          `📋 <b>Escalonamento para Gerente</b>\n` +
          `Falha ID: ${falhaId}\n` +
          `Gerente: @${gerente.username}\n` +
          `Erro: ${erro}\n`
        );
      }
    } else {
      await enviarTelegram(
        `🆘 <b>Escalação Máxima - Suporte Claude</b>\n` +
        `Falha ID: ${falhaId}\n` +
        `Agente: ${agente}\n` +
        `Erro: ${erro}\n` +
        `Tentativas: ${tentativas}\n`
      );
    }

    await sql`
      UPDATE falhas_agentes
      SET tentativas = tentativas + 1
      WHERE id = ${falhaId}
    `;
  } catch (error) {
    console.error("Erro ao escalonar falha:", error);
  }
}

export async function analisarTaxaErros(): Promise<{
  taxaErro: number;
  status: "crítica" | "alta" | "normal";
}> {
  try {
    const resultado = await Promise.race<FalhaResult[]>([
      sql<FalhaResult[]>`
        SELECT COUNT(*) as total
        FROM falhas_agentes
        WHERE criado_em > NOW() - INTERVAL '2 hours'
        AND resolvido = FALSE
      `,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
      ),
    ]);

    const total = Array.isArray(resultado) && resultado.length > 0 ? resultado[0].total : 0;
    const taxaErro = typeof total === "number" ? total : 0;

    let status: "crítica" | "alta" | "normal" = "normal";
    if (taxaErro > 50) status = "crítica";
    else if (taxaErro > 20) status = "alta";

    if (status === "crítica") {
      await enviarTelegram(
        `🚨 <b>Taxa de Erros Crítica</b>\n` +
        `Erros nos últimos 2h: ${taxaErro}\n` +
        `Status: ${status}\n`
      );
    }

    return { taxaErro, status };
  } catch (error) {
    console.error("Erro ao analisar taxa de erros:", error);
    return { taxaErro: 0, status: "normal" };
  }
}

export async function executarRotinaManutenção(): Promise<void> {
  try {
    await limparBacklogFalhas();
    await analisarTaxaErros();

    const falhasNaoResolvidas = await obterFalhasNaoResolvidas();
    for (const falha of falhasNaoResolvidas) {
      await escalonarFalha(falha.id, falha.agente, falha.erro);
    }
  } catch (error) {
    console.error("Erro na rotina de manutenção:", error);
    await enviarTelegram(
      `❌ <b>Erro na