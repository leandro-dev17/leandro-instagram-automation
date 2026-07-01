import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
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
    const [ativosRow] = await sql`
      SELECT COUNT(*) as total FROM assinaturas WHERE status = 'ativo'
    `;
    const [novos28Row] = await sql`
      SELECT COUNT(*) as total FROM assinaturas
      WHERE status = 'ativo' AND renovada_em >= NOW() - INTERVAL '28 days'
    `;
    const [cancel28Row] = await sql`
      SELECT COUNT(*) as total FROM assinaturas
      WHERE status = 'cancelado' AND renovada_em >= NOW() - INTERVAL '28 days'
    `;

    const mrr = Number(mrrRow.mrr);
    const totalAtivos = Number(ativosRow.total);
    const novos4sem = Number(novos28Row.total);
    const cancel4sem = Number(cancel28Row.total);

    const novosMes = novos4sem;
    const cancelMes = cancel4sem;
    const churnMensal = totalAtivos > 0 ? cancelMes / (totalAtivos + cancelMes) : 0;
    const ticketMedio = totalAtivos > 0 ? mrr / totalAtivos : 9.97;

    const proj30 = mrr * (1 - churnMensal) + novosMes * ticketMedio;
    const proj60 = proj30 * (1 - churnMensal) + novosMes * ticketMedio;
    const proj90 = proj60 * (1 - churnMensal) + novosMes * ticketMedio;

    const queda30 = proj30 < mrr * 0.9;
    const icon30 = queda30 ? "🔴" : proj30 >= mrr ? "🟢" : "🟡";

    const data = new Date().toLocaleDateString("pt-BR");
    const msg =
      `📈 <b>Previsão de Receita — Vovó Teresinha</b>\n` +
      `📅 ${data}\n\n` +
      `💰 <b>MRR atual:</b> R$ ${mrr.toFixed(2)}\n` +
      `📉 <b>Churn mensal:</b> ${(churnMensal * 100).toFixed(1)}%\n` +
      `🆕 <b>Novos/mês (média 4 sem):</b> ${novosMes}\n` +
      `🎫 <b>Ticket médio:</b> R$ ${ticketMedio.toFixed(2)}\n\n` +
      `<b>Projeções:</b>\n` +
      `${icon30} <b>30 dias:</b> R$ ${proj30.toFixed(2)}\n` +
      `🔵 <b>60 dias:</b> R$ ${proj60.toFixed(2)}\n` +
      `🔵 <b>90 dias:</b> R$ ${proj90.toFixed(2)}\n\n` +
      `<i>Próxima previsão: próxima segunda-feira</i>`;

    await enviarTelegram(msg);

    if (queda30) {
      await enviarTelegram(
        `⚠️ <b>ALERTA PROJEÇÃO!</b> MRR estimado cair de R$ ${mrr.toFixed(2)} para R$ ${proj30.toFixed(2)} em 30 dias. Revisar retenção!`
      );
    }

    return NextResponse.json({ ok: true, mrr, proj30, proj60, proj90, churn_mensal: churnMensal });
  } catch (err) {
    console.error("previsao-receita error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
