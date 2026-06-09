/**
 * HEARTBEAT HELENA — Monitor Central Diário
 * Publica dashboard completo de saúde do app no Vovó Teresinha Bot.
 * Inclui métricas de usuários, receitas, assinaturas, agentes e alertas.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const data = new Date().toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });

    // ── Métricas de usuários ────────────────────────────────────
    const [usuarios]   = await sql`SELECT COUNT(*)::int AS total FROM usuarios`;
    const [premium]    = await sql`SELECT COUNT(*)::int AS total FROM usuarios WHERE tipo_usuario = 'premium'`;
    const [trial]      = await sql`SELECT COUNT(*)::int AS total FROM usuarios WHERE tipo_usuario = 'trial'`;
    const [free]       = await sql`SELECT COUNT(*)::int AS total FROM usuarios WHERE tipo_usuario = 'free'`;
    const [novos7d]    = await sql`SELECT COUNT(*)::int AS total FROM usuarios WHERE criado_em > NOW() - INTERVAL '7 days'`;

    // ── Métricas de assinaturas ─────────────────────────────────
    const [assinaturas] = await sql`SELECT COUNT(*)::int AS total FROM assinaturas WHERE status = 'ativo'`;
    const [cancelados]  = await sql`SELECT COUNT(*)::int AS total FROM assinaturas WHERE status = 'cancelado' AND renovada_em > NOW() - INTERVAL '30 days'`;

    // ── Métricas de receitas ────────────────────────────────────
    const [receitas]     = await sql`SELECT COUNT(*)::int AS total FROM receitas`;
    const [receitasNovas]= await sql`SELECT COUNT(*)::int AS total FROM receitas WHERE created_at > NOW() - INTERVAL '7 days'`;

    // ── Métricas de engagement ──────────────────────────────────
    const [favoritos]    = await sql`SELECT COUNT(*)::int AS total FROM favoritos`;
    const [pushSubs]     = await sql`SELECT COUNT(*)::int AS total FROM push_subscriptions WHERE ativo = true`;

    // ── Saúde dos agentes ───────────────────────────────────────
    const [falhasAbertas]= await sql`SELECT COUNT(*)::int AS total FROM falhas_agentes WHERE resolvido = false`;
    const [falhas24h]    = await sql`SELECT COUNT(*)::int AS total FROM falhas_agentes WHERE criado_em > NOW() - INTERVAL '24 hours'`;

    const topFalhas = await sql`
      SELECT agente, COUNT(*)::int AS total
      FROM falhas_agentes
      WHERE resolvido = false AND criado_em > NOW() - INTERVAL '24 hours'
      GROUP BY agente
      ORDER BY total DESC
      LIMIT 5
    ` as { agente: string; total: number }[];

    // ── Filas ───────────────────────────────────────────────────
    const [filaWpp] = await sql`SELECT COUNT(*)::int AS total FROM whatsapp_fila WHERE status = 'pendente'`;

    // ── Indicador de saúde ──────────────────────────────────────
    const saudePct = Math.max(0, 100 - (Number(falhasAbertas.total) * 2));
    const saudeEmoji = saudePct >= 90 ? "🟢" : saudePct >= 70 ? "🟡" : "🔴";

    const linhas = [
      `🍲 <b>Vovó Teresinha Bot — Heartbeat ${data}</b>`,
      ``,
      `${saudeEmoji} <b>Saúde Geral: ${saudePct}%</b>`,
      ``,
      `<b>👥 Usuários:</b>`,
      `  Total: ${usuarios.total} | Novos (7d): ${novos7d.total}`,
      `  Premium: ${premium.total} | Trial: ${trial.total} | Free: ${free.total}`,
      ``,
      `<b>💳 Assinaturas:</b>`,
      `  Ativas: ${assinaturas.total} | Canceladas (30d): ${cancelados.total}`,
      ``,
      `<b>📖 Receitas:</b>`,
      `  Total: ${receitas.total} | Novas (7d): ${receitasNovas.total}`,
      ``,
      `<b>💜 Engagement:</b>`,
      `  Favoritos salvos: ${favoritos.total}`,
      `  Push subscriptions ativas: ${pushSubs.total}`,
      ``,
      `<b>🤖 Agentes:</b>`,
      `  Falhas abertas: ${falhasAbertas.total}`,
      `  Falhas (24h): ${falhas24h.total}`,
      `  Fila WhatsApp pendente: ${filaWpp.total}`,
    ];

    if (topFalhas.length > 0) {
      linhas.push(``, `<b>🔴 Agentes com falhas:</b>`);
      for (const f of topFalhas) {
        linhas.push(`  • ${f.agente}: ${f.total} falha(s)`);
      }
    } else {
      linhas.push(``, `✅ <b>Todos os agentes funcionando corretamente!</b>`);
    }

    linhas.push(``, `<i>Relatório automático do Squad de Monitoramento.</i>`);

    await enviarTelegram(linhas.join("\n"));
    await resolverFalhas("heartbeat-receitas");

    return NextResponse.json({
      ok: true,
      saude_pct: saudePct,
      usuarios: usuarios.total,
      premium: premium.total,
      trial: trial.total,
      assinaturas_ativas: assinaturas.total,
      receitas: receitas.total,
      falhas_abertas: falhasAbertas.total,
    });
  } catch (err) {
    await reportarFalha("heartbeat-receitas", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
