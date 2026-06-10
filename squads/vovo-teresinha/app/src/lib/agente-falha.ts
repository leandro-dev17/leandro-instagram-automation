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
        sql<FalhaResult[]>`
          SELECT COUNT(*) as total FROM falhas_agentes
          WHERE agente = ${agente}
            AND resolvido = FALSE
            AND criado_em > NOW() - INTERVAL '2 hours'
        `,
        new Promise((_, reject) =>
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

    const especialista = getEspecialistaResponsavel(agente);
    if (especialista) {
      await enviarTelegram(
        `🔧 <b>Especialista acionado: ${especialista}</b>\n\n` +
        `Agente <b>${agente}</b> falhou ${consecutivas}x.\n` +
        `Erro: <code>${erro.slice(0, 200)}</code>`
      );

      fetch(`${APP_URL}/api/cron/${especialista}?secret=${CRON_SECRET}`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {});
    } else {
      await enviarTelegram(
        `⚠️ <b>Atenção — ${agente}</b>\n\n` +
        `Falha detectada ${consecutivas}x nas últimas 2h.\n` +
        `Erro: <code>${erro.slice(0, 200)}</code>\n\n` +
        `<a href="${APP_URL}/admin/falhas">Ver detalhes</a>`
      );
    }
  } catch {
    //
  }
}

export async function validarWebhookMercadoPago(payload: unknown): Promise<boolean> {
  if (!payload) {
    await reportarFalha(
      "webhook_mp_valida_assinatura",
      "Payload vazio recebido",
      { statusCode: 400, esperado: "400/401/403", recebido: "404" }
    );
    return false;
  }

  if (typeof payload !== "object" || !("id" in payload)) {
    await reportarFalha(
      "webhook_mp_valida_assinatura",
      "Payload inválido",
      { payload, statusCode: 400 }
    );
    return false;
  }

  return true;
}

export async function marcarFalhaResolvida(agente: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolvido_em = NOW()
      WHERE agente = ${agente} AND resolvido = FALSE
    `;

    await enviarTelegram(
      `✅ <b>Falha resolvida</b>\n\n` +
      `Agente: <b>${agente}</b>\n` +
      `Status: Normalizado`
    );
  } catch {
    await enviarTelegram(
      `❌ <b>Erro ao marcar falha como resolvida</b>\n\n` +
      `Agente: ${agente}`
    );
  }
}