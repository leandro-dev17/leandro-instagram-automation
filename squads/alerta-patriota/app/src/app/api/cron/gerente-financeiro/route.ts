/**
 * MAJOR FINANCEIRO — Gerente Financeiro
 * Consolida saúde financeira: assinaturas, inadimplência, trials, MRR.
 * Score 0-100. Se < 50 → escala para CEO.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";
import { calcularMRR } from "@/lib/mrr";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const problemas: string[] = [];
  let score = 100;

  // 1. MRR atual — fonte única (lib/mrr.ts), não usuarios×preço-hardcoded
  try {
    const { mrrTotal: mrr } = await calcularMRR();

    // Compara com snapshot da semana passada
    const snapSemana = await sql`
      SELECT detalhes FROM agentes_log
      WHERE agente = 'marcos-mrr' AND acao = 'mrr_snapshot'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (snapSemana.length > 0) {
      const mrrAnterior = (snapSemana[0] as { detalhes: { mrr_total?: number } }).detalhes?.mrr_total ?? 0;
      if (mrrAnterior > 0) {
        const queda = ((mrrAnterior - mrr) / mrrAnterior) * 100;
        if (queda > 20) { problemas.push(`MRR caiu ${queda.toFixed(1)}% vs semana passada`); score -= 25; }
        else if (queda > 10) { problemas.push(`MRR caiu ${queda.toFixed(1)}% vs semana passada`); score -= 10; }
      }
    }
  } catch { /* silencioso */ }

  // 2. Inadimplentes
  try {
    const inadimplentes = await sql`
      SELECT plano, COUNT(*) as total FROM usuarios
      WHERE status = 'inadimplente'
      GROUP BY plano
    `;
    let totalInad = 0;
    for (const r of inadimplentes) {
      totalInad += parseInt((r as { total: string }).total);
    }
    if (totalInad > 5) { problemas.push(`${totalInad} usuários inadimplentes`); score -= 15; }
    else if (totalInad > 2) { problemas.push(`${totalInad} usuários inadimplentes`); score -= 5; }
  } catch { /* silencioso */ }

  // 3. Pagamentos pendentes há mais de 2h (Pix expirado)
  try {
    const pixPendentes = await sql`
      SELECT COUNT(*) as total FROM pagamentos
      WHERE status = 'pendente' AND metodo = 'pix'
        AND created_at < NOW() - INTERVAL '2 hours'
    `;
    const n = parseInt((pixPendentes[0] as { total: string }).total);
    if (n > 0) { problemas.push(`${n} pagamentos Pix pendentes há mais de 2h`); score -= 5 * n; }
  } catch { /* silencioso */ }

  // 4. Trials expirando sem converter
  try {
    const trialsRisco = await sql`
      SELECT COUNT(*) as total FROM usuarios
      WHERE status = 'trial'
        AND trial_fim BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
    `;
    const n = parseInt((trialsRisco[0] as { total: string }).total);
    if (n > 3) { problemas.push(`${n} trials expiram em 24h sem converter`); score -= 5; }
  } catch { /* silencioso */ }

  // Item 20 (Fase 30): score só subtraía, sem teto inferior — vários problemas simultâneos
  // (ex.: muitos Pix pendentes, onde o desconto é `5 * n` sem limite) podiam levar o score
  // bem abaixo de 0, exibindo algo como "Score: -50/100" nos alertas e no log, quando a
  // documentação do próprio arquivo declara a escala como 0-100.
  score = Math.max(0, Math.min(100, score));

  // ── ESCALONAMENTO ────────────────────────────────────────────────────────
  if (score < 50) {
    await fetch(`${APP_URL}/api/cron/relatorio-ceo?origem=gerente-financeiro&score=${score}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});

    await enviarTelegram(
      `💰 *MAJOR FINANCEIRO — SITUAÇÃO CRÍTICA*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `❌ ${p}`).join("\n") +
      "\n\n🆘 General Alves CEO foi acionado."
    );
  } else if (score < 80 && problemas.length > 0) {
    await enviarTelegram(
      `💰 *MAJOR FINANCEIRO — Atenção*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `⚠️ ${p}`).join("\n")
    );
  }

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
    VALUES ('gerente-financeiro', 'consolidar_financeiro', ${score >= 70 ? "sucesso" : "aviso"},
      ${JSON.stringify({ score, problemas })}, ${Date.now() - inicio})
  `.catch(() => {});

  return NextResponse.json({ ok: score >= 70, score, problemas });
}
