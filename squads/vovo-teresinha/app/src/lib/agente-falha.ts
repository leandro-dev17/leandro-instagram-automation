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
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agente, erro, tentativas: consecutivas, dados }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {});

      return;
    }

    if (consecutivas >= LIMITE_ESPECIALISTA) {
      const especialista = getEspecialistaResponsavel(agente);
      await enviarTelegram(
        `🔧 <b>${especialista.replace(/-/g, " ")} acionado</b>\n\n` +
        `Agente <b>${agente}</b> apresentando ${consecutivas} falhas consecutivas.\n` +
        `Especialista investigando...`
      );

      fetch(`${APP_URL}/api/cron/${especialista}?secret=${CRON_SECRET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agente, erro, tentativas: consecutivas, dados }),
        signal: AbortSignal.timeout(HTTP_TIMEOUT),
      }).catch(() => {});

      return;
    }
  } catch {
    //
  }
}

export async function verificarStatusAgentes(): Promise<void> {
  try {
    const resultado = await sql`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '1 hour'
      GROUP BY agente
      ORDER BY total DESC
    ` as unknown as Array<{ agente: string; total: number }>;

    if (Array.isArray(resultado) && resultado.length > 0) {
      let mensagem = "📈 <b>Relatório de Falhas (Última Hora)</b>\n\n";
      resultado.forEach((item) => {
        mensagem += `• ${item.agente}: ${item.total} falha(s)\n`;
      });
      await enviarTelegram(mensagem);
    }
  } catch {
    await enviarTelegram("⚠️ <b>Erro ao verificar status dos agentes</b>");
  }
}
```