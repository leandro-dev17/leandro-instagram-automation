import { NextRequest, NextResponse } from "next/server";
import { enviarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const apiKey = process.env.BREVO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ ok: false, motivo: "BREVO_API_KEY não configurada" });
  }

  try {
    // Estatísticas de emails transacionais dos últimos 7 dias
    const hoje = new Date();
    const seteDiasAtras = new Date(hoje.getTime() - 7 * 24 * 60 * 60 * 1000);
    const startDate = seteDiasAtras.toISOString().split("T")[0];
    const endDate = hoje.toISOString().split("T")[0];

    const res = await fetch(
      `https://api.brevo.com/v3/smtp/statistics/aggregatedReport?startDate=${startDate}&endDate=${endDate}`,
      {
        headers: { "api-key": apiKey, Accept: "application/json" },
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!res.ok) {
      return NextResponse.json({ ok: false, motivo: `Brevo API erro ${res.status}` });
    }

    const stats = await res.json();
    const alertas: string[] = [];

    const enviados = stats.requests || 0;
    const entregues = stats.delivered || 0;
    const bounces = stats.hardBounces + stats.softBounces || 0;
    const spam = stats.spamReports || 0;
    const abertos = stats.uniqueOpens || 0;

    const taxaBounce = enviados > 0 ? (bounces / enviados) * 100 : 0;
    const taxaSpam = enviados > 0 ? (spam / enviados) * 100 : 0;
    const taxaAbertura = entregues > 0 ? (abertos / entregues) * 100 : 0;

    if (taxaBounce > 3) alertas.push(`Bounce rate alto: ${taxaBounce.toFixed(1)}% (limite 3%)`);
    if (taxaSpam > 0.1) alertas.push(`Spam rate alto: ${taxaSpam.toFixed(2)}% (limite 0,1%)`);
    if (enviados > 10 && taxaAbertura < 15)
      alertas.push(`Taxa de abertura baixa: ${taxaAbertura.toFixed(1)}% (mínimo 15%)`);

    const iconeGeral = alertas.length === 0 ? "🟢" : taxaSpam > 0.2 ? "🔴" : "🟡";
    const data = new Date().toLocaleDateString("pt-BR");

    const msg =
      `📧 <b>Reputação de Email — ${data}</b>\n\n` +
      `${iconeGeral} <b>Status geral: ${alertas.length === 0 ? "Saudável" : "Atenção"}</b>\n\n` +
      `📊 <b>Últimos 7 dias:</b>\n` +
      `• Emails enviados: ${enviados}\n` +
      `• Entregues: ${entregues}\n` +
      `• Abertos: ${abertos} (${taxaAbertura.toFixed(1)}%)\n` +
      `• Bounces: ${bounces} (${taxaBounce.toFixed(1)}%)\n` +
      `• Spam reports: ${spam} (${taxaSpam.toFixed(2)}%)\n` +
      (alertas.length > 0
        ? `\n⚠️ <b>Alertas:</b>\n${alertas.map((a) => `• ${a}`).join("\n")}`
        : `\n✅ Tudo dentro dos limites.`) +
      `\n\n<i>Próxima verificação: próxima segunda</i>`;

    await enviarTelegram(msg);

    if (taxaSpam > 0.2) {
      await enviarTelegram(
        `🚨 <b>ALERTA CRÍTICO — Spam rate!</b>\n` +
          `Taxa de spam em ${taxaSpam.toFixed(2)}% — risco de suspensão do Brevo!\n` +
          `Revise a lista de contatos imediatamente.`
      );
    }

    return NextResponse.json({
      ok: alertas.length === 0,
      stats: { enviados, entregues, bounces, spam, abertos, taxaBounce, taxaSpam, taxaAbertura },
      alertas,
    });
  } catch (err) {
    console.error("reputacao-email error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
