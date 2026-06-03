/**
 * SARGENTO CONTEÚDO — Gerente de Conteúdo e Publicações
 * Consolida saúde do pipeline de conteúdo: coleta, curadoria, resumo, cards.
 * Score 0-100. Se < 50 → escala para CEO.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const problemas: string[] = [];
  let score = 100;

  // 1. Cards enviados hoje
  try {
    const hoje = await sql`
      SELECT acao, COUNT(*) as total FROM agentes_log
      WHERE agente = 'gerador-card'
        AND status = 'sucesso'
        AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      GROUP BY acao
    `;
    const porGrupo: Record<string, number> = {};
    for (const r of hoje) porGrupo[(r as { acao: string }).acao] = parseInt((r as { total: string }).total);

    const limitesEsperados = { card_basico: 1, card_patriota: 1, card_vip: 2, card_elite: 2 };
    for (const [acao, minimo] of Object.entries(limitesEsperados)) {
      const enviados = porGrupo[acao] ?? 0;
      const hora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
      if (hora >= 14 && enviados < minimo) {
        problemas.push(`${acao}: apenas ${enviados}/${minimo} cards enviados hoje`);
        score -= 15;
      }
    }
  } catch { problemas.push("Erro ao verificar cards enviados"); score -= 10; }

  // 2. Estoque de notícias prontas
  try {
    const estoque = await sql`
      SELECT
        COUNT(*) FILTER (WHERE resumo_braga IS NOT NULL AND postada_basico = false) as basico,
        COUNT(*) FILTER (WHERE resumo_cavalcanti IS NOT NULL AND postada_elite = false) as elite
      FROM noticias
      WHERE created_at > NOW() - INTERVAL '12 hours'
    `;
    const s = estoque[0] as { basico: string; elite: string };
    if (parseInt(s.basico) < 1) { problemas.push("Estoque crítico: 0 notícias prontas para Básico/VIP"); score -= 20; }
    else if (parseInt(s.basico) < 2) { problemas.push("Estoque baixo: apenas 1 notícia para Básico/VIP"); score -= 5; }
    if (parseInt(s.elite) < 1) { problemas.push("Estoque crítico: 0 análises prontas para Elite"); score -= 10; }
  } catch { /* silencioso */ }

  // 3. Conteúdo irrelevante publicado recentemente
  try {
    const alertasConteudo = await sql`
      SELECT COUNT(*) as total FROM alertas
      WHERE tipo = 'conteudo_irrelevante'
        AND resolvido = false
        AND created_at > NOW() - INTERVAL '24 hours'
    `;
    const n = parseInt((alertasConteudo[0] as { total: string }).total);
    if (n > 0) { problemas.push(`${n} alertas de conteúdo irrelevante nas últimas 24h`); score -= 10; }
  } catch { /* silencioso */ }

  // 4. Pipeline completou hoje?
  try {
    const pipeline = await sql`
      SELECT
        MAX(CASE WHEN agente = 'neto-noticias' AND status = 'sucesso' THEN 1 ELSE 0 END) as coletou,
        MAX(CASE WHEN agente = 'curador-carlos' AND status = 'sucesso' THEN 1 ELSE 0 END) as curou,
        MAX(CASE WHEN agente = 'bernardo-resumidor' AND status = 'sucesso' THEN 1 ELSE 0 END) as resumiu
      FROM agentes_log
      WHERE created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    `;
    const p = pipeline[0] as { coletou: number; curou: number; resumiu: number };
    const hora = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })).getHours();
    if (hora >= 10) {
      if (!p.coletou) { problemas.push("Neto Notícias não coletou hoje"); score -= 15; }
      if (!p.curou)   { problemas.push("Curador Carlos não rodou hoje"); score -= 15; }
      if (!p.resumiu) { problemas.push("Bernardo Resumidor não rodou hoje"); score -= 15; }
    }
  } catch { /* silencioso */ }

  // ── ESCALONAMENTO ────────────────────────────────────────────────────────
  if (score < 50) {
    await fetch(`${APP_URL}/api/cron/relatorio-ceo?origem=gerente-conteudo&score=${score}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});

    await enviarTelegram(
      `📝 *SARGENTO CONTEÚDO — SITUAÇÃO CRÍTICA*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `❌ ${p}`).join("\n") +
      "\n\n🆘 General Alves CEO foi acionado."
    );
  } else if (score < 80 && problemas.length > 0) {
    await enviarTelegram(
      `📝 *SARGENTO CONTEÚDO — Atenção*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `⚠️ ${p}`).join("\n")
    );
  }

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
    VALUES ('gerente-conteudo', 'consolidar_conteudo', ${score >= 70 ? "sucesso" : "aviso"},
      ${JSON.stringify({ score, problemas })}, ${Date.now() - inicio})
  `.catch(() => {});

  return NextResponse.json({ ok: score >= 70, score, problemas });
}
