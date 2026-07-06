```typescript
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
      console.error("Erro na limpeza de backlog:", error);
    }
  }
}

export async function registrarFalhaAgente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  try {
    const resultado = await sql<[FalhaResult]>`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE)
      RETURNING (SELECT COUNT(*) as total FROM falhas_agentes WHERE agente = ${agente} AND resolvido = FALSE) as total
    `;

    const totalFalhas = resultado[0]?.total || 0;

    if (totalFalhas >= LIMITE_CLAUDE) {
      await escalarParaClaude(agente, erro, dados);
    } else if (totalFalhas >= LIMITE_GERENTE) {
      await escalarParaGerente(agente, erro, dados);
    } else if (totalFalhas >= LIMITE_ESPECIALISTA) {
      await escalarParaEspecialista(agente, erro, dados);
    }
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
    await enviarTelegram(
      `❌ <b>Erro ao Registrar Falha</b>\n` +
      `Agente: ${agente}\n` +
      `Erro: ${error instanceof Error ? error.message : "Desconhecido"}`
    );
  }
}

async function escalarParaEspecialista(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  const especialista = await getEspecialistaResponsavel(agente);
  if (especialista) {
    await enviarTelegram(
      `🔴 <b>Escalação para Especialista</b>\n` +
      `Especialista: ${especialista}\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}`
    );
  }
}

async function escalarParaGerente(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  const gerente = await getGerenteResponsavel(agente);
  if (gerente) {
    await enviarTelegram(
      `🟠 <b>Escalação para Gerente</b>\n` +
      `Gerente: ${gerente}\n` +
      `Agente: ${agente}\n` +
      `Erro: ${erro}`
    );
  }
}

async function escalarParaClaude(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  await enviarTelegram(
    `🚨 <b>Escalação Crítica - Claude AI</b>\n` +
    `Agente: ${agente}\n` +
    `Erro: ${erro}\n` +
    `Dados: ${JSON.stringify(dados || {})}`
  );
}

export async function resolverFalha(falhaId: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${falhaId}
    `;

    await enviarTelegram(
      `✅ <b>Falha Resolvida</b>\n` +
      `ID: ${falhaId}`
    );
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasNaoResolvidas(): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 50
    `;
    return falhas;
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
  }
}

export async function analisarTendenciasFalhas(): Promise<void> {
  try {
    const tendencias = await sql<Array<{ agente: string; contagem: number }>>`
      SELECT agente, COUNT(*) as contagem
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
      AND resolvido = FALSE
      GROUP BY agente
      ORDER BY contagem DESC
      LIMIT 10
    `;

    if (tendencias.length > 0) {
      let mensagem = `📊 <b>Tendências de Falhas (2h)</b>\n`;
      for (const trend of tendencias) {
        mensagem += `${trend.agente}: ${trend.contagem} erros\n`;
      }
      await enviarTelegram(mensagem);
    }
  } catch (error) {
    console.error("Erro ao analisar tendências:", error);
  }
}

export async function validarWebhookMercadoPago(
  payload: unknown,
  signature: string | null
): Promise<{ valid: boolean; statusCode: number; message: string }> {
  try {
    if (!payload) {
      await registrarFalhaAgente(
        "webhook_mp_valida_assinatura",
        "Payload ausente",
        { statusCode: 400 }
      );
      return {
        valid: false,
        statusCode: 400,
        message: "Payload ausente",
      };
    }

    if (!signature) {
      await registrarFalhaAgente(
        "webhook_mp_valida_assinatura",
        "Assinatura ausente",
        { statusCode: 401 }
      );
      return {
        valid: false,
        statusCode: 401,
        message: "Assinatura ausente",
      };
    }

    const validacao = await validarAssinaturaMercadoPago(payload);

    if (!validacao.valid) {
      await registrarFalhaAgente(
        "webhook_mp_valida_assinatura",
        validacao.message,
        { statusCode: validacao.statusCode, payload }
      );
    }

    return validacao;
  } catch (error) {
    await registrarFalhaAgente(
      "webhook_mp_valida_assinatura",
      `Erro na validação: ${error instanceof Error ? error.message : "Desconhecido"}`,
      { statusCode: 500 }
    );
    return {
      valid: false,
      statusCode: 500,
      message: `Erro na validação: ${error instanceof Error ? error.message : "Desconhecido"}`,
    };
  }
}

export async function processarFalhasEmMassa(): Promise<void> {
  try {
    const falhasAberta = await sql<Array<{ id: number; agente: string; erro: string }>>`
      SELECT id, agente, erro
      FROM falhas_agentes
      WHERE resolvido = FALSE
      LIMIT ${LIMITE_BACKLOG}
    `;

    for (const falha of falhasAberta) {
      try {
        const url = `${APP_URL}/api/falhas/${falha.id}/processar`;
        const response = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-cron-secret":