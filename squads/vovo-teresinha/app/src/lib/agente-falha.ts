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

interface WebhookValidacaoPayload {
  agente: string;
  erro: string;
  dados?: Record<string, unknown>;
  statusCode?: number;
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
        `👨‍💼 <b>${especialista.replace(/-/g, " ")} acionado</b>\n\n` +
        `Agente <b>${agente}</b> com ${consecutivas} falhas consecutivas.\n` +
        `Especialista investigando...`
      );

      fetch(`${APP_URL}/api/cron/${especialista}?secret=${CRON_SECRET}`, {
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {});

      return;
    }
  } catch {
    //
  }
}

export async function validarPayloadWebhook(payload: unknown, tipo: string): Promise<boolean> {
  if (!payload) {
    const erro = `Webhook ${tipo} recebido sem payload`;
    await reportarFalha(`webhook_${tipo}`, erro, { tipo, timestamp: new Date().toISOString() });
    return false;
  }

  if (typeof payload !== "object") {
    const erro = `Webhook ${tipo} payload inválido (tipo: ${typeof payload})`;
    await reportarFalha(`webhook_${tipo}`, erro, { tipo, payloadType: typeof payload });
    return false;
  }

  return true;
}

export async function tratarErroWebhookMP(
  statusCode: number,
  erro: string,
  dados?: Record<string, unknown>
): Promise<Response> {
  const codigosValidos = [400, 401, 403];

  if (statusCode === 404) {
    await reportarFalha(
      "webhook_mp_valida_assinatura",
      `Payload ausente - retornando ${statusCode} em vez de ${codigosValidos[0]}`,
      { statusCode, erro, dados }
    );

    return new Response(
      JSON.stringify({ erro: "Payload inválido ou ausente" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  if (!codigosValidos.includes(statusCode)) {
    await reportarFalha(
      "webhook_mp_valida_assinatura",
      `Status code inesperado: ${statusCode}`,
      { statusCode, erro, dados }
    );

    return new Response(
      JSON.stringify({ erro: "Requisição inválida" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(
    JSON.stringify({ erro }),
    { status: statusCode, headers: { "Content-Type": "application/json" } }
  );
}

export async function monitarSaude(): Promise<void> {
  try {
    const resultado = await sql`
      SELECT 
        agente,
        COUNT(*) as total,
        COUNT(CASE WHEN resolvido = TRUE THEN 1 END) as resolvidas
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
      GROUP BY agente
      HAVING COUNT(*) >= 5
      ORDER BY total DESC
      LIMIT 5
    ` as unknown as Array<{ agente: string; total: number; resolvidas: number }>;

    if (Array.isArray(resultado) && resultado.length > 0) {
      const mensagem = resultado
        .map(r => `<b>${r.agente}</b>: ${r.total} falhas (${r.resolvidas} resolvidas)`)
        .join("\n");

      await enviarTelegram(
        `🔴 <b>Alerta de Saúde - Agentes Críticos</b>\n\n${mensagem}\n\nInvestigar imediatamente.`
      );
    }
  } catch {
    await enviarTelegram(`⚠️ <b>Erro ao monitorar saúde dos agentes</b>`);
  }
}