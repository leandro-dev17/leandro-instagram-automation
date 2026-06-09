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

  const alertas: string[] = [];
  let scoreFin = 100;

  try {
    // MRR e variação (usa renovada_em para novos/cancelados do dia)
    const [metricas] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ativo') as ativos,
        COUNT(*) FILTER (WHERE status = 'ativo' AND renovada_em > NOW() - INTERVAL '24 hours') as novos_24h,
        COUNT(*) FILTER (WHERE status IN ('cancelado','paused') AND renovada_em > NOW() - INTERVAL '24 hours') as cancelados_24h,
        SUM(CASE WHEN status = 'ativo' AND plano = 'anual' THEN valor/12
                 WHEN status = 'ativo' AND plano = 'trimestral' THEN valor/3
                 ELSE 0 END) as mrr
      FROM assinaturas
    `;

    const cancelados = Number(metricas.cancelados_24h ?? 0);
    const novos = Number(metricas.novos_24h ?? 0);
    const mrr = Number(metricas.mrr ?? 0);

    if (cancelados > novos && cancelados > 2) {
      alertas.push(`Churn diário: ${cancelados} cancelamentos vs ${novos} novas assinaturas`);
      scoreFin -= 20;
    }

    // Usuários premium sem assinatura (inconsistência financeira)
    const [inconsistentes] = await sql`
      SELECT COUNT(*) as total FROM usuarios u
      WHERE tipo_usuario = 'premium'
        AND NOT EXISTS (SELECT 1 FROM assinaturas a WHERE a.usuario_id = u.id AND a.status = 'ativo')
    `;
    const nInc = Number(inconsistentes.total);
    if (nInc > 0) {
      alertas.push(`${nInc} usuário(s) premium sem assinatura ativa — inconsistência financeira`);
      scoreFin -= 10;
    }

    // Verifica falhas financeiras não resolvidas
    const [falhasFin] = await sql`
      SELECT COUNT(*) as total FROM falhas_agentes
      WHERE agente IN ('fiscal-pagamentos', 'agente-assinaturas', 'reputacao-email')
        AND resolvido = FALSE AND criado_em > NOW() - INTERVAL '4 hours'
    `;
    if (Number(falhasFin.total) > 3) {
      alertas.push(`${falhasFin.total} falhas financeiras não resolvidas nas últimas 4h`);
      scoreFin -= 15;
    }

    // Escala para Claude se crítico
    if (scoreFin < 50 && CRON_SECRET) {
      fetch(`${APP_URL}/api/webhooks/claude-resolver?secret=${CRON_SECRET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agente: "gerente-financeiro",
          erro: alertas.join("; "),
          tentativas: 5,
          dados: { mrr, scoreFin, alertas },
        }),
      }).catch(() => {});

      await enviarTelegram(
        `💰 <b>Gerente Financeiro — CRÍTICO!</b>\n\n` +
        `MRR: R$ ${mrr.toFixed(2)} | Score: ${scoreFin}/100\n` +
        alertas.map(a => `❌ ${a}`).join("\n") +
        `\n\n🤖 Claude Resolver foi acionado.`
      );
    } else if (alertas.length > 0) {
      await enviarTelegram(
        `💰 <b>Gerente Financeiro — Atenção</b>\n\n` +
        alertas.map(a => `⚠️ ${a}`).join("\n")
      );
    }

    return NextResponse.json({ ok: scoreFin >= 70, score: scoreFin, alertas, mrr });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
