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

interface FalhaResult {
  total: number;
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
    } catch {
      clearTimeout(timeoutId);
      await enviarTelegram(`⚠️ <b>DB Latência Crítica</b>\n\nAgente: ${agente}\nLatência excedida ao contar falhas.`);
    }

    try {
      await sql`
        INSERT INTO falhas_agentes (agente, erro, dados, tentativas)
        VALUES (${agente}, ${erro}, ${JSON.stringify(dados ?? {})}, ${consecutivas})
      `;
    } catch {
      await enviarTelegram(`⚠️ <b>DB Error</b>\n\nFalha ao inserir registro de agente: ${agente}`);
    }
  } catch {
    //
  }

  if (consecutivas < 3) return;
  if (!CRON_SECRET) return;

  try {
    if (consecutivas >= LIMITE_CLAUDE) {
      await enviarTelegram(
        `🤖 <b>Claude Resolver ativado para ${agente}</b>\n` +
        `${consecutivas} falhas consecutivas. Investigando automaticamente...`
      );

      fetch(`${APP_URL}/api/webhooks/claude-resolver?secret=${CRON_SECRET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agente, erro, tentativas: consecutivas, dados }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {});

      return;
    }

    if (consecutivas >= LIMITE_GERENTE) {
      const gerente = getGerenteResponsavel(agente);
      await enviarTelegram(
        `📊 <b>${gerente.replace(/-/g, " ")} acionado</b>\n\n` +
        `Agente <b>${agente}</b> com ${consecutivas} falhas consecutivas.\n` +
        `Gerente analisando o problema...`
      );

      fetch(`${APP_URL}/api/cron/${gerente}?secret=${CRON_SECRET}`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {});

      return;
    }

    if (consecutivas >= LIMITE_ESPECIALISTA) {
      const especialista = getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `👨‍💼 <b>${especialista.replace(/-/g, " ")} notificado</b>\n\n` +
        `Agente <b>${agente}</b> com ${consecutivas} falhas consecutivas.\n` +
        `Especialista revisando...`
      );

      fetch(`${APP_URL}/api/cron/${especialista}?secret=${CRON_SECRET}`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {});

      return;
    }
  } catch {
    await enviarTelegram(`⚠️ <b>Erro ao processar falha</b>\n\nAgente: ${agente}\nErro: ${erro}`);
  }
}

export async function validarPayloadWebhook(
  payload: unknown,
  tipo: string
): Promise<{ valido: boolean; status: number }> {
  if (!payload) {
    await reportarFalha(
      "webhook_mp_valida_assinatura",
      "Payload vazio ou inválido",
      { tipo, payload: null }
    );
    return { valido: false, status: 400 };
  }

  if (typeof payload !== "object") {
    await reportarFalha(
      "webhook_mp_valida_assinatura",
      "Payload não é um objeto",
      { tipo, payloadType: typeof payload }
    );
    return { valido: false, status: 400 };
  }

  return { valido: true, status: 200 };
}

export async function verificarSaudeAgentes(): Promise<void> {
  try {
    const falhasNaUltimaHora = await sql`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      GROUP BY agente
      ORDER BY total DESC
      LIMIT 10
    ` as unknown as Array<{ agente: string; total: number }>;

    if (Array.isArray(falhasNaUltimaHora) && falhasNaUltimaHora.length > 0) {
      const resumo = falhasNaUltimaHora
        .map(f => `${f.agente}: ${f.total} falhas`)
        .join("\n");

      await enviarTelegram(
        `📈 <b>Relatório de Saúde - Últimas 1h</b>\n\n${resumo}`
      );
    }
  } catch {
    await enviarTelegram(`⚠️ <b>Erro ao verificar saúde dos agentes</b>`);
  }
}