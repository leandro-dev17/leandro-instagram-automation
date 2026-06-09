import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const [ativos] = await sql`
      SELECT COUNT(*) as total FROM assinaturas WHERE status = 'ativo'
    `;
    const [novos] = await sql`
      SELECT COUNT(*) as total FROM assinaturas
      WHERE status = 'ativo' AND renovada_em >= NOW() - INTERVAL '7 days'
    `;
    const [cancelamentos] = await sql`
      SELECT COUNT(*) as total FROM assinaturas
      WHERE status = 'cancelado' AND renovada_em >= NOW() - INTERVAL '7 days'
    `;
    const [mrrRow] = await sql`
      SELECT COALESCE(SUM(
        CASE
          WHEN plano = 'anual' THEN valor / 12
          WHEN plano = 'trimestral' THEN valor / 3
          ELSE valor
        END
      ), 0) as mrr
      FROM assinaturas WHERE status = 'ativo'
    `;
    const [usuarios] = await sql`SELECT COUNT(*) as total FROM usuarios`;

    const totalAtivos = Number(ativos.total);
    const totalNovos = Number(novos.total);
    const totalCancel = Number(cancelamentos.total);
    const mrr = Number(mrrRow.mrr);
    const totalUsuarios = Number(usuarios.total);

    const base = totalAtivos + totalCancel;
    const churn = base > 0 ? (totalCancel / base) * 100 : 0;
    const churnIcon = churn > 5 ? "🔴" : churn > 2 ? "🟡" : "🟢";

    const data = new Date().toLocaleDateString("pt-BR");
    const msg =
      `📊 <b>Relatório Semanal — Vovó Teresinha</b>\n` +
      `📅 ${data}\n\n` +
      `👑 <b>Assinantes ativos:</b> ${totalAtivos}\n` +
      `🆕 <b>Novos (7 dias):</b> ${totalNovos}\n` +
      `❌ <b>Cancelamentos (7 dias):</b> ${totalCancel}\n` +
      `${churnIcon} <b>Churn rate:</b> ${churn.toFixed(1)}%${churn > 5 ? " ⚠️ ACIMA DO LIMITE!" : ""}\n` +
      `💰 <b>MRR estimado:</b> R$ ${mrr.toFixed(2)}\n` +
      `👥 <b>Total usuários:</b> ${totalUsuarios}\n\n` +
      `<i>Próximo relatório: próxima segunda-feira</i>`;

    await enviarTelegram(msg);

    if (churn > 5) {
      await enviarTelegram(
        `🚨 <b>ALERTA CHURN!</b> Taxa em ${churn.toFixed(1)}% — acima de 5%. Investigar cancelamentos imediatamente!`
      );
    }

    return NextResponse.json({
      ok: true,
      total_ativos: totalAtivos,
      novos_semana: totalNovos,
      cancelamentos_semana: totalCancel,
      churn: churn.toFixed(1),
      mrr: mrr.toFixed(2),
      total_usuarios: totalUsuarios,
    });
  } catch (err) {
    console.error("monitor-relatorios error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
