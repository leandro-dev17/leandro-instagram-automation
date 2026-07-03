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
const TEMPO_RETENCAO_FALHAS = 24; // horas

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
  if (!payload || typeof payload !== "object") {
    return {
      valid: false,
      statusCode: 400,
      message: "Payload inválido ou vazio",
    };
  }

  const webhookPayload = payload as WebhookMercadoPagoPayload;

  if (!webhookPayload.type || !webhookPayload.data?.id) {
    return {
      valid: false,
      statusCode: 400,
      message: "Campos obrigatórios ausentes",
    };
  }

  return {
    valid: true,
    statusCode: 200,
    message: "Validação bem-sucedida",
  };
}

export async function limparBacklogFalhas(): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DB_TIMEOUT);

    try {
      const falhasAntiga = await Promise.race([
        sql`
          SELECT id FROM falhas_agentes
          WHERE criado_em < NOW() - INTERVAL '${TEMPO_RETENCAO_FALHAS} hours'
          AND resolvido = TRUE
          LIMIT 1000
        ` as unknown as Promise<Array<{ id: number }>>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      clearTimeout(timeoutId);

      if (Array.isArray(falhasAntiga) && falhasAntiga.length > 0) {
        const ids = falhasAntiga.map((f) => f.id);
        await sql`
          DELETE FROM falhas_agentes
          WHERE id = ANY(${ids})
        `;
        
        await enviarTelegram(
          `🧹 <b>Limpeza de Backlog Executada</b>\n` +
          `Registros removidos: ${ids.length}\n` +
          `Retenção: ${TEMPO_RETENCAO_FALHAS}h`
        );
      }

      const totalAberto = await Promise.race([
        sql`
          SELECT COUNT(*) as total FROM falhas_agentes
          WHERE resolvido = FALSE
        ` as unknown as Promise<FalhaResult[]>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      clearTimeout(timeoutId);

      if (Array.isArray(totalAberto) && totalAberto[0].total > LIMITE_BACKLOG) {
        await enviarTelegram(
          `⚠️ <b>Alerta: Backlog Crítico</b>\n` +
          `Total de falhas abertas: ${totalAberto[0].total}\n` +
          `Limite: ${LIMITE_BACKLOG}`
        );
      }
    } catch (erro) {
      clearTimeout(timeoutId);
      await enviarTelegram(
        `❌ <b>Erro ao limpar backlog</b>\n` +
        `${erro instanceof Error ? erro.message : "Erro desconhecido"}`
      );
    }
  } catch (erro) {
    console.error("Erro crítico em limparBacklogFalhas:", erro);
  }
}

export async function reportarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  let consecutivas = 1;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DB_TIMEOUT);

    try {
      const resultado = await Promise.race([
        sql`
          SELECT COUNT(*) as total FROM falhas_agentes
          WHERE agente = ${agente}
            AND resolvido = FALSE
            AND criado_em > NOW() - INTERVAL '2 hours'
        ` as unknown as Promise<FalhaResult[]>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      clearTimeout(timeoutId);

      if (Array.isArray(resultado) && resultado.length > 0) {
        consecutivas = Number(resultado[0].total) + 1;
      }
    } catch (erro) {
      clearTimeout(timeoutId);
      await enviarTelegram(
        `⚠️ <b>DB Latência Crítica</b>\n\nAgente: ${agente}\n` +
        `Erro: ${erro instanceof Error ? erro.message : "Timeout na query"}`
      );
    }

    try {
      await sql`
        INSERT INTO falhas_agentes (agente, erro, dados, tentativas)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados ?? {})}, ${consecutivas})
      `;
    } catch (erro) {
      await enviarTelegram(
        `❌ <b>DB Error</b>\n\nFalha ao inserir registro de agente: ${agente}\n` +
        `Erro: ${erro instanceof Error ? erro.message : "Erro desconhecido"}`
      );
    }
  } catch (erro) {
    console.error("Erro crítico em reportarFalha:", erro);
  }

  if (consecutivas < 3) return;
  if (!CRON_SECRET) return;

  try {
    if (consecutivas >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🤖 <b>Claude Resolver ativado para ${agente}</b>\n` +
        `${consecutivas} falhas consecutivas. Investigando automaticamente.`
      );

      await fetch(`${APP_URL}/api/webhook/claude-resolver`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${CRON_SECRET}`,
        },
        body: JSON.stringify({
          agente,
          consecutivas,
          erro,
        }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {
        enviarTelegram(
          `⚠️ <b>Claude Resolver - Erro na chamada</b>\n` +
          `Agente: ${agente}`
        );
      });

      return;
    }

    if (consecutivas >= LIMITE_GERENTE) {
      const gerente = await getGerenteResponsavel(agente);

      await enviarTelegram(
        `📋 <b>Escalação para Gerente</b>\n` +
        `Agente: ${agente}\n` +
        `Gerente: ${gerente || "Não atribuído"}\n` +
        `Falhas: ${consecutivas}`
      );

      return;
    }

    if (consecutivas >= LIMITE_ESPECIALISTA) {
      const especialista = await getEspecialistaResponsavel(agente);

      await enviarTelegram(
        `🔧 <b>Escalação para Especialista</b>\n` +
        `Agente: ${agente}\n` +
        `Especialista: ${especialista || "Não atribuído"}\n` +
        `Falhas: ${consecutivas}`
      );
    }
  } catch (erro) {
    console.error("Erro ao escalar falha:", erro);
  }
}

export async function resolverFalha(
  falhaId: number,
  resolucao: string
): Promise<void> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), DB_TIMEOUT);

    try {
      const falha = await Promise.race([
        sql`
          SELECT agente, erro FROM falhas_agentes WHERE id = ${falhaId}
        ` as unknown as Promise<Array<{ agente: string; erro: string }>>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("DB_TIMEOUT")), DB_TIMEOUT)
        ),
      ]);

      clearTimeout(timeoutId);

      if (!Array.isArray(falha) || falha.length === 0) {
        await enviarTelegram(`⚠️ <b>Falha não encontrada</b>\nID: ${falhaId}`);
        return;
      }

      await sql`
        UPDATE falhas_agentes
        SET resolvido = TRUE, resolucao = ${resolucao}
        WHERE id = ${falhaId}
      `;

      await enviarTelegram(
        `✅ <b>Falha Resolvida</b>\n` +
        `Agente: ${falha[0].agente}\n` +
        `Resolução: ${resolucao}`
      );
    } catch (erro) {
      clearTimeout(timeoutId);
      throw erro;
    }
  } catch (erro) {
    await enviarTelegram(
      `❌ <b>Erro ao resolver falha</b>\n` +
      `ID: ${falhaId}\n` +
      `Erro: ${erro instanceof Error ? erro.message : "Erro desconhecido"}`
    );
  }
}

export async function obterEstatisticasFalhas(): Promise<{
  total: number;
  abertos: number;
  resolvidos: number;
  ultimasHoras: number;
}> {
  try {
    const result = await sql`
      SELECT
        (SELECT COUNT(*) FROM falhas_agentes) as total,
        (SELECT COUNT(*) FROM falhas_agentes WHERE resolvido = FALSE) as abertos,
        (SELECT COUNT(*) FROM falhas_agentes WHERE resolvido = TRUE) as resolvidos,
        (SELECT COUNT(*) FROM falhas_agentes WHERE criado_em > NOW() - INTERVAL '1 hour') as ultimas_horas
    ` as unknown as Promise<
      Array<{
        total: number;
        abertos: number;
        resolvidos: number;
        ultimas_horas: number;
      }>
    >;

    if (Array.isArray(result) && result.length > 0) {
      const stats = result[0];
      return {
        total: Number(stats.total),
        abertos