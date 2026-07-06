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
        `❌ <b>Erro ao Limpar Backlog</b>\n` +
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
    const resultado = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE resolvido = FALSE
    `;

    const totalAberto = resultado?.[0]?.total ?? 0;

    if (totalAberto >= LIMITE_BACKLOG) {
      await enviarTelegram(
        `⚠️ <b>Backlog de Falhas Crítico</b>\n` +
        `Total de falhas abertas: ${totalAberto}\n` +
        `Agente: ${agente}\n` +
        `Execute limpeza de dados.\n`
      );
      return;
    }

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, resolvido, criado_em)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados || {})}, FALSE, NOW())
    `;
  } catch (error) {
    console.error("Erro ao registrar falha:", error);
  }
}

export async function resolverFalha(id: number): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE
      WHERE id = ${id}
    `;
  } catch (error) {
    console.error("Erro ao resolver falha:", error);
  }
}

export async function obterFalhasAbertasPorAgente(
  agente: string
): Promise<FalhaRegistro[]> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE agente = ${agente}
      AND resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 10
    `;
    return falhas ?? [];
  } catch (error) {
    console.error("Erro ao obter falhas:", error);
    return [];
  }
}

export async function analisarFalhas(): Promise<void> {
  try {
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT 20
    `;

    if (!Array.isArray(falhas) || falhas.length === 0) {
      return;
    }

    const agentesFalhas: Record<string, number> = {};
    falhas.forEach((falha) => {
      agentesFalhas[falha.agente] = (agentesFalhas[falha.agente] ?? 0) + 1;
    });

    const maioresFalhas = Object.entries(agentesFalhas)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5);

    if (maioresFalhas.length > 0) {
      const resumo = maioresFalhas
        .map(([agente, count]) => `${agente}: ${count}`)
        .join("\n");

      await enviarTelegram(
        `📊 <b>Análise de Falhas</b>\n` +
        `${resumo}\n` +
        `Total: ${falhas.length}\n`
      );
    }

    for (const [agente, count] of maioresFalhas) {
      if (count >= LIMITE_ESPECIALISTA) {
        const especialista = await getEspecialistaResponsavel(agente);
        if (especialista) {
          await enviarTelegram(
            `🚨 <b>Escalonamento: Especialista Necessário</b>\n` +
            `Agente: ${agente}\n` +
            `Falhas: ${count}\n` +
            `Especialista: ${especialista}\n`
          );
        }
      }

      if (count >= LIMITE_GERENTE) {
        const gerente = await getGerenteResponsavel(agente);
        if (gerente) {
          await enviarTelegram(
            `🔴 <b>Escalonamento: Gerente Necessário</b>\n` +
            `Agente: ${agente}\n` +
            `Falhas: ${count}\n` +
            `Gerente: ${gerente}\n`
          );
        }
      }

      if (count >= LIMITE_CLAUDE) {
        await enviarTelegram(
          `⚡ <b>Escalonamento: Claude IA Necessário</b>\n` +
          `Agente: ${agente}\n` +
          `Falhas: ${count}\n` +
          `Recomendação: Análise aprofundada\n`
        );
      }
    }
  } catch (error) {
    console.error("Erro ao analisar falhas:", error);
  }
}

export async function executarAgenteFalha(): Promise<void> {
  const token = process.env.REQUEST_AUTHORIZATION;

  try {
    const response = await Promise.race<Response>([
      fetch(`${APP_URL}/api/falhas/analisar`, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          cron_secret: CRON_SECRET,
        }),
      }),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("HTTP_TIMEOUT")), HTTP_TIMEOUT)
      ),
    ]);

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    await analisarFalhas();
    await limparBacklogFalhas();
  } catch (error) {
    const mensagem =
      error instanceof Error ? error.message : "Erro desconhecido";
    await enviarTelegram(
      `❌ <b>Erro no Agente de Falhas</b>\n${mensagem}\n`
    );
    console.error("Erro ao executar agente de falhas:", error);
  }
}