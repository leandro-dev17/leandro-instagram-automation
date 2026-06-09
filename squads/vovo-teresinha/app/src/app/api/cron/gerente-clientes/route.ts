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

  const insights: string[] = [];
  let scoreClientes = 100;

  try {
    // Novos usuários nas últimas 24h
    let nNovos = 0;
    try {
      const [novos] = await sql`
        SELECT COUNT(*) as total FROM usuarios
        WHERE criada_em > NOW() - INTERVAL '24 hours'
      `;
      nNovos = Number(novos.total);
    } catch { /* coluna pode não existir */ }

    // Usuários em risco de churn (do preditor-churn)
    const [emRisco] = await sql`
      SELECT valor FROM app_configuracoes WHERE chave = 'usuarios_risco_churn'
    `;
    const risco = emRisco ? Number(emRisco.valor) : 0;

    // Desistentes para contatar
    const [desistentes] = await sql`
      SELECT COUNT(*) as total FROM app_configuracoes
      WHERE chave LIKE 'desistente_contatado_%'
        AND valor NOT LIKE '%disparado%'
    `;

    const nDesistentes = Number(desistentes.total);

    if (risco > 10) {
      insights.push(`${risco} assinantes em risco de churn`);
      scoreClientes -= 15;
    }

    if (nDesistentes > 20) {
      insights.push(`${nDesistentes} desistentes aguardando reativação`);
      scoreClientes -= 10;
    }

    // Dispara o processo de recontato se houver muitos pendentes
    if (nDesistentes > 5 && CRON_SECRET) {
      fetch(`${APP_URL}/api/cron/disparador-campanhas?secret=${CRON_SECRET}`, {
        signal: AbortSignal.timeout(30000),
      }).catch(() => {});
    }

    // Relatório diário de clientes
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    if (insights.length > 0 || nNovos > 0) {
      await enviarTelegram(
        `👥 <b>Gerente de Clientes — ${hora}</b>\n\n` +
        `✨ Novos hoje: ${nNovos}\n` +
        (insights.length > 0 ? insights.map(i => `⚠️ ${i}`).join("\n") : "✅ Clientes estáveis") +
        `\n\nScore: ${scoreClientes}/100`
      );
    }

    // Escala para Claude se crítico
    if (scoreClientes < 50 && CRON_SECRET) {
      fetch(`${APP_URL}/api/webhooks/claude-resolver?secret=${CRON_SECRET}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agente: "gerente-clientes",
          erro: insights.join("; "),
          tentativas: 5,
          dados: { scoreClientes, risco, nDesistentes },
        }),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: scoreClientes >= 70, score: scoreClientes, insights });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
