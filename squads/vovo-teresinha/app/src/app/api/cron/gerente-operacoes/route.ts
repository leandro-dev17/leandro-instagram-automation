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

  const data = new Date().toLocaleDateString("pt-BR");
  const secoes: string[] = [];
  let scoreTotal = 100;

  // === 1. FALHAS NAS ÚLTIMAS 24H ===
  try {
    const falhas = await sql`
      SELECT agente, COUNT(*) as total, MAX(criado_em) as ultima
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '24 hours'
      GROUP BY agente
      ORDER BY total DESC
    `;

    if (falhas.length > 0) {
      scoreTotal -= falhas.length * 5;
      const linhas = falhas.map(f =>
        `  • ${f.agente}: ${f.total}x (última: ${new Date(f.ultima).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })})`
      );
      secoes.push(`⚠️ <b>Falhas nas últimas 24h:</b>\n${linhas.join("\n")}`);
    } else {
      secoes.push(`✅ <b>Nenhuma falha registrada nas últimas 24h</b>`);
    }
  } catch {
    secoes.push(`⚠️ Não foi possível verificar histórico de falhas`);
  }

  // === 2. SAÚDE DO BANCO ===
  try {
    const inicio = Date.now();
    await sql`SELECT 1`;
    const lat = Date.now() - inicio;
    const icone = lat > 1000 ? "🟡" : "🟢";
    secoes.push(`${icone} <b>Banco:</b> ${lat}ms`);
    if (lat > 1000) scoreTotal -= 10;
  } catch {
    secoes.push(`🔴 <b>Banco:</b> indisponível`);
    scoreTotal -= 30;
  }

  // === 3. ASSINATURAS INCONSISTENTES ===
  try {
    const [inconsistentes] = await sql`
      SELECT COUNT(*) as total FROM usuarios u
      WHERE u.tipo_usuario = 'premium'
        AND NOT EXISTS (
          SELECT 1 FROM assinaturas a
          WHERE a.usuario_id = u.id AND a.status = 'ativo'
        )
    `;
    const n = Number(inconsistentes.total);
    if (n > 0) {
      secoes.push(`🟡 <b>Assinaturas inconsistentes:</b> ${n} usuário(s) — serão corrigidos às 7h`);
      scoreTotal -= 5;
    } else {
      secoes.push(`✅ <b>Assinaturas:</b> todas consistentes`);
    }
  } catch {
    // silencioso
  }

  // === 4. ROTAS CRÍTICAS ===
  const rotasOk: string[] = [];
  const rotasFalha: string[] = [];
  for (const rota of ["/api/receitas", "/api/configuracoes/vapid-public"]) {
    try {
      const r = await fetch(`${APP_URL}${rota}`, { signal: AbortSignal.timeout(8000) });
      if (r.status < 500) rotasOk.push(rota);
      else { rotasFalha.push(`${rota} (${r.status})`); scoreTotal -= 15; }
    } catch {
      rotasFalha.push(`${rota} (timeout)`);
      scoreTotal -= 15;
    }
  }
  if (rotasFalha.length > 0) secoes.push(`🔴 <b>Rotas com falha:</b> ${rotasFalha.join(", ")}`);
  else secoes.push(`✅ <b>API:</b> todas as rotas respondendo`);

  // === 5. DISPARAR AGENTE-ASSINATURAS SE HOUVER INCONSISTÊNCIAS ===
  try {
    if (CRON_SECRET) {
      await fetch(`${APP_URL}/api/cron/agente-assinaturas?secret=${CRON_SECRET}`, {
        signal: AbortSignal.timeout(15000),
      });
    }
  } catch {
    // silencioso — não bloqueia o relatório
  }

  // === SCORE FINAL ===
  const scoreClamp = Math.max(0, scoreTotal);
  const iconeScore = scoreClamp >= 90 ? "🟢" : scoreClamp >= 70 ? "🟡" : "🔴";

  const msg =
    `📋 <b>Gerente de Operações — ${data}</b>\n\n` +
    `${iconeScore} <b>Score de Saúde: ${scoreClamp}/100</b>\n\n` +
    secoes.join("\n\n") +
    `\n\n<i>Próximo relatório: amanhã às 7h</i>`;

  await enviarTelegram(msg);

  return NextResponse.json({ ok: true, score: scoreClamp, secoes });
}
