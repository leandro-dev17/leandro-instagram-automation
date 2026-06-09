/**
 * GERENTE RENATA RETENÇÃO — Gerente de Retenção (Nível 4)
 * Analisa métricas de churn, trial e conversão. Aciona subagentes conforme necessidade.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Métricas de retenção
    const [trialExpirando] = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
      WHERE tipo_usuario = 'trial'
        AND trial_fim BETWEEN NOW() AND NOW() + INTERVAL '48 hours'
    `;

    const [trialExpirado] = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
      WHERE tipo_usuario = 'trial' AND trial_fim < NOW()
    `;

    const [cancelados30d] = await sql`
      SELECT COUNT(*)::int AS total FROM assinaturas
      WHERE status = 'cancelado'
        AND renovada_em > NOW() - INTERVAL '30 days'
    `;

    const [freeNaoConvertidos] = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
      WHERE tipo_usuario = 'free'
        AND criado_em < NOW() - INTERVAL '7 days'
        AND id NOT IN (
          SELECT usuario_id FROM assinaturas
          WHERE status IN ('ativo', 'cancelado', 'expirada')
        )
    `;

    const dispatched: string[] = [];

    // Notifica trials expirando em 48h
    if (Number(trialExpirando.total) > 0) {
      fetch(`${APP}/api/cron/notificador-trial`, {
        headers: { Authorization: `Bearer ${CRON}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      dispatched.push(`notificador-trial (${trialExpirando.total} trial(s) expirando)`);
    }

    // Converte usuários free que nunca assinaram (>7 dias)
    if (Number(freeNaoConvertidos.total) > 0) {
      fetch(`${APP}/api/cron/conversor-free`, {
        headers: { Authorization: `Bearer ${CRON}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      dispatched.push(`conversor-free (${freeNaoConvertidos.total} usuário(s) free 7d+)`);
    }

    // Recupera cancelados
    if (Number(cancelados30d.total) > 0) {
      fetch(`${APP}/api/cron/cacador-desistentes`, {
        headers: { Authorization: `Bearer ${CRON}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      dispatched.push(`cacador-desistentes (${cancelados30d.total} cancelamento(s))`);
    }

    await enviarTelegram(
      `🎯 <b>Gerente Retenção — Relatório</b>\n\n` +
      `📊 Trial expirando (48h): ${trialExpirando.total}\n` +
      `⏰ Trial já expirado: ${trialExpirado.total}\n` +
      `❌ Cancelados (30d): ${cancelados30d.total}\n` +
      `👤 Free não convertidos (7d+): ${freeNaoConvertidos.total}\n` +
      (dispatched.length > 0
        ? `\n🚀 <b>Subagentes acionados:</b>\n${dispatched.map(d => `  • ${d}`).join("\n")}`
        : "\n✅ Nenhuma ação urgente de retenção")
    );

    await resolverFalhas("gerente-retencao");
    return NextResponse.json({
      ok: true,
      dispatched,
      trial_expirando: trialExpirando.total,
      cancelados_30d: cancelados30d.total,
      free_nao_convertidos: freeNaoConvertidos.total,
    });
  } catch (err) {
    await reportarFalha("gerente-retencao", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
