import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const problemas: string[] = [];
  let scoresTecnico = 100;

  // Verifica saúde geral do banco
  try {
    const inicio = Date.now();
    await sql`SELECT 1`;
    const lat = Date.now() - inicio;
    if (lat > 2000) { problemas.push(`Banco lento: ${lat}ms`); scoresTecnico -= 20; }
  } catch { problemas.push("Banco indisponível"); scoresTecnico -= 40; }

  // Conta falhas técnicas nas últimas 4h
  try {
    const agentestecnicos = ["fiscal-banco", "fiscal-erros-api", "performance", "saude-pwa", "circuit-breaker", "backup-monitor", "guardiao-seguranca"];
    const [falhas] = await sql`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente = ANY(${agentestecnicos})
        AND resolvido = FALSE
        AND criado_em > NOW() - INTERVAL '4 hours'
    `;
    const n = Number(falhas.total);
    if (n > 5) { problemas.push(`${n} falhas técnicas não resolvidas nas últimas 4h`); scoresTecnico -= 15; }
  } catch { /* silencioso */ }

  // Verifica circuit breakers ativos
  try {
    const circuitsAtivos = await sql`
      SELECT chave FROM app_configuracoes
      WHERE chave LIKE 'circuit_break_%' AND valor = 'true'
    `;
    if (circuitsAtivos.length > 0) {
      problemas.push(`Circuit breakers ativos: ${circuitsAtivos.map(c => c.chave.replace("circuit_break_", "")).join(", ")}`);
      scoresTecnico -= 10 * circuitsAtivos.length;
    }
  } catch { /* silencioso */ }

  // Se há problemas graves, escala para Claude
  if (scoresTecnico < 50 && CRON_SECRET) {
    const erroConsolidado = problemas.join("; ");
    fetch(`${APP_URL}/api/webhooks/claude-resolver`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": `Bearer ${CRON_SECRET}` },
      body: JSON.stringify({
        agente: "gerente-tecnico",
        erro: erroConsolidado,
        tentativas: 5,
        dados: { score: scoresTecnico, problemas },
      }),
    }).catch(() => {});

    await enviarTelegram(
      `⚙️ <b>Gerente Técnico — Situação Crítica!</b>\n\n` +
      `Score técnico: ${scoresTecnico}/100\n` +
      problemas.map(p => `❌ ${p}`).join("\n") +
      `\n\n🤖 Claude Resolver foi acionado automaticamente.`
    );
  } else if (problemas.length > 0) {
    await enviarTelegram(
      `⚙️ <b>Gerente Técnico — Atenção</b>\n\n` +
      `Score: ${scoresTecnico}/100\n` +
      problemas.map(p => `⚠️ ${p}`).join("\n")
    );
  }

  return NextResponse.json({ ok: scoresTecnico >= 70, score: scoresTecnico, problemas });
}
