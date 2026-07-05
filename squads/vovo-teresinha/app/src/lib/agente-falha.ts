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
    const falhas = await sql<FalhaRegistro[]>`
      SELECT id, agente, erro, resolvido, criado_em
      FROM falhas_agentes
      WHERE resolvido = FALSE
      ORDER BY criado_em DESC
      LIMIT ${LIMITE_BACKLOG}
    `;
    return Array.isArray(falhas) ? falhas : [];
  } catch (error) {
    console.error("Erro ao obter falhas não resolvidas:", error);
    return [];
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

export async function contar Falhas(): Promise<number> {
  try {
    const result = await sql<FalhaResult[]>`
      SELECT COUNT(*) as total
      FROM falhas_agentes
      WHERE resolvido = FALSE
    `;
    return Array.isArray(result) && result.length > 0 ? result[0].total : 0;
  } catch (error) {
    console.error("Erro ao contar falhas:", error);
    return 0;
  }
}

export async function notificarEquipe(
  falha: FalhaRegistro,
  tentativa: number
): Promise<void> {
  try {
    if (tentativa <= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(falha.agente);
      if (especialista) {
        await enviarTelegram(
          `🔴 <b>Falha de Agente</b>\n` +
          `Agente: ${falha.agente}\n` +
          `Erro: ${falha.erro}\n` +
          `Atribuído a: ${especialista}\n` +
          `Tentativa: ${tentativa}`
        );
      }
    } else if (tentativa <= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(falha.agente);
      if (gerente) {
        await enviarTelegram(
          `🟠 <b>Falha de Agente - Escalação para Gerente</b>\n` +
          `Agente: ${falha.agente}\n` +
          `Erro: ${falha.erro}\n` +
          `Gerente responsável: ${gerente}\n` +
          `Tentativa: ${tentativa}`
        );
      }
    } else if (tentativa <= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🟡 <b>Falha de Agente - Análise Claude</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Tentativa: ${tentativa}\n` +
        `Status: Aguardando análise de IA`
      );
    } else {
      await enviarTelegram(
        `🔴 <b>Falha Crítica - Escalação Final</b>\n` +
        `Agente: ${falha.agente}\n` +
        `Erro: ${falha.erro}\n` +
        `Tentativa: ${tentativa}\n` +
        `Status: Requer intervenção manual urgente`
      );
    }
  } catch (error) {
    console.error("Erro ao notificar equipe:", error);
  }
}

export async function processarFalhas(): Promise<void> {
  const falhas = await obterFalhasNaoResolvidas();

  for (const falha of falhas) {
    try {
      let tentativa = 1;
      const maxTentativas = LIMITE_CLAUDE + 2;

      while (tentativa <= maxTentativas) {
        try {
          await notificarEquipe(falha, tentativa);

          if (tentativa >= maxTentativas) {
            await resolverFalha(falha.id);
            break;
          }

          tentativa++;
          await new Promise((resolve) => setTimeout(resolve, 5000));
        } catch (error) {
          console.error(`Erro na tentativa ${tentativa}:`, error);
          tentativa++;
        }
      }
    } catch (error) {
      console.error(`Erro ao processar falha ${falha.id}:`, error);
    }
  }
}

export async function analisarTaxaErros(): Promise<{
  taxaErros: number;
  totalFalhas: number;
  status: string;
}> {
  try {
    const totalFalhas = await contarFalhas();
    const taxaErros = (totalFalhas / 100) * 100;

    let status = "✅ Normal";
    if (taxaErros > 30) {
      status = "🔴 Crítico";
    } else if (taxaErros > 15) {
      status = "🟠 Alto";
    } else if (taxaErros > 5) {
      status = "🟡 Moderado";
    }

    return {
      taxaErros,
      totalFalhas,
      status,
    };
  } catch (error) {
    console.error("Erro ao analisar taxa de erros:", error);
    return {
      taxaErros: 0,
      totalFalhas: 0,
      status: "❌ Erro na análise",
    };
  }
}
```