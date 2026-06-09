import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { getGerenteResponsavel, getEspecialistaResponsavel } from "@/lib/hierarquia";

// Falhas consecutivas (últimas 2h) por nível de ação
const LIMITE_ESPECIALISTA = 3; // 3ª falha → chama especialista
const LIMITE_GERENTE = 4;      // 4ª falha → chama gerente
const LIMITE_CLAUDE = 5;       // 5ª falha → chama Claude Resolver

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

export async function reportarFalha(
  agente: string,
  erro: string,
  dados?: Record<string, unknown>
): Promise<void> {
  let consecutivas = 1;

  try {
    const [resultado] = await sql`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente = ${agente}
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '2 hours'
    `;
    consecutivas = Number(resultado.total) + 1;

    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, tentativas)
      VALUES (${agente}, ${erro}, ${JSON.stringify(dados ?? {})}, ${consecutivas})
    `;
  } catch {
    // Se o banco está fora não bloqueia o alerta
  }

  // 1ª e 2ª falha — silenciosas, apenas registradas
  if (consecutivas < 3) return;

  if (!CRON_SECRET) return;

  // 5ª falha+ → Claude Resolver
  if (consecutivas >= LIMITE_CLAUDE) {
    await enviarTelegram(
      `🤖 <b>Claude Resolver ativado para ${agente}</b>\n` +
      `${consecutivas} falhas consecutivas. Investigando automaticamente...`
    );
    fetch(`${APP_URL}/api/webhooks/claude-resolver?secret=${CRON_SECRET}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agente, erro, tentativas: consecutivas, dados }),
    }).catch(() => {});
    return;
  }

  // 4ª falha → chama o gerente responsável
  if (consecutivas >= LIMITE_GERENTE) {
    const gerente = getGerenteResponsavel(agente);
    await enviarTelegram(
      `📊 <b>${gerente.replace(/-/g, " ")} acionado</b>\n\n` +
      `Agente <b>${agente}</b> com ${consecutivas} falhas consecutivas.\n` +
      `Gerente analisando o problema...`
    );
    fetch(`${APP_URL}/api/cron/${gerente}?secret=${CRON_SECRET}`, {
      signal: AbortSignal.timeout(55000),
    }).catch(() => {});
    return;
  }

  // 3ª falha → chama especialista (se houver) ou já avisa
  const especialista = getEspecialistaResponsavel(agente);
  if (especialista) {
    await enviarTelegram(
      `🔧 <b>Especialista acionado: ${especialista}</b>\n\n` +
      `Agente <b>${agente}</b> falhou ${consecutivas}x.\n` +
      `Erro: <code>${erro.slice(0, 200)}</code>`
    );
    fetch(`${APP_URL}/api/cron/${especialista}?secret=${CRON_SECRET}`, {
      signal: AbortSignal.timeout(55000),
    }).catch(() => {});
  } else {
    // Sem especialista: aviso direto no Telegram na 3ª falha
    await enviarTelegram(
      `⚠️ <b>Atenção — ${agente}</b>\n\n` +
      `Falha detectada ${consecutivas}x nas últimas 2h\n` +
      `Erro: <code>${erro.slice(0, 200)}</code>\n` +
      `\n<i>Na próxima falha o gerente responsável será acionado.</i>`
    );
  }
}

export async function resolverFalhas(agente: string): Promise<void> {
  try {
    await sql`
      UPDATE falhas_agentes
      SET resolvido = TRUE, resolvido_em = NOW()
      WHERE agente = ${agente} AND resolvido = FALSE
    `;
  } catch {
    // silencioso
  }
}

export async function contarFalhasAtivas(agente: string): Promise<number> {
  try {
    const [r] = await sql`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente = ${agente} AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '2 hours'
    `;
    return Number(r.total);
  } catch {
    return 0;
  }
}
