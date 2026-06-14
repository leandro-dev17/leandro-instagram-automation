/**
 * CAPITÃ CLIENTES — Gerente de Clientes e Retenção
 * Consolida saúde do relacionamento com membros: engajamento, churn, grupos.
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

  // 1. Cancelamentos nas últimas 24h
  try {
    const cancelamentos = await sql`
      SELECT COUNT(*) as total FROM usuarios
      WHERE status = 'cancelado'
        AND updated_at > NOW() - INTERVAL '24 hours'
    `;
    const n = parseInt((cancelamentos[0] as { total: string }).total);
    if (n >= 5) { problemas.push(`${n} cancelamentos nas últimas 24h`); score -= 20; }
    else if (n >= 3) { problemas.push(`${n} cancelamentos nas últimas 24h`); score -= 10; }
  } catch (err) { problemas.push(`Erro ao verificar cancelamentos: ${String(err)}`); score -= 5; }

  // 2. Variação de membros nos grupos
  try {
    const grupos = await sql`
      SELECT nome, plano, membros_ativos FROM grupos_whatsapp WHERE ativo = true
    `;
    const snapAnterior = await sql`
      SELECT detalhes FROM agentes_log
      WHERE agente = 'carlos-cargo' AND acao = 'membros_snapshot'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (snapAnterior.length > 0) {
      const snap = (snapAnterior[0] as { detalhes: Record<string, number> }).detalhes ?? {};
      for (const g of grupos) {
        const grupo = g as { nome: string; plano: string; membros_ativos: number };
        const anterior = snap[grupo.plano] ?? grupo.membros_ativos;
        if (anterior > 0) {
          const queda = ((anterior - grupo.membros_ativos) / anterior) * 100;
          if (queda > 20) { problemas.push(`Grupo ${grupo.plano}: queda de ${queda.toFixed(0)}% de membros`); score -= 20; }
          else if (queda > 10) { problemas.push(`Grupo ${grupo.plano}: queda de ${queda.toFixed(0)}% de membros`); score -= 10; }
        }
      }
    }
  } catch (err) { problemas.push(`Erro ao verificar variação de membros: ${String(err)}`); score -= 5; }

  // 3. Usuários inativos (sem engajamento há 15+ dias)
  try {
    const inativos = await sql`
      SELECT COUNT(*) as total FROM usuarios
      WHERE status = 'ativo'
        AND assinatura_fim > NOW()
        AND updated_at < NOW() - INTERVAL '15 days'
    `;
    const n = parseInt((inativos[0] as { total: string }).total);
    if (n > 10) { problemas.push(`${n} membros inativos há 15+ dias`); score -= 10; }
  } catch (err) { problemas.push(`Erro ao verificar membros inativos: ${String(err)}`); score -= 5; }

  // 4. Bot responder funcionando?
  try {
    const botLog = await sql`
      SELECT status FROM agentes_log
      WHERE agente = 'bot-responder'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (botLog.length === 0) { problemas.push("Bot Responder nunca executou"); score -= 5; }
    else if ((botLog[0] as { status: string }).status === "erro") { problemas.push("Bot Responder com erro"); score -= 10; }
  } catch (err) { problemas.push(`Erro ao verificar Bot Responder: ${String(err)}`); score -= 5; }

  // ── ESCALONAMENTO ────────────────────────────────────────────────────────
  if (score < 50) {
    await fetch(`${APP_URL}/api/cron/relatorio-ceo?origem=gerente-clientes&score=${score}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});

    await enviarTelegram(
      `👥 *CAPITÃ CLIENTES — SITUAÇÃO CRÍTICA*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `❌ ${p}`).join("\n") +
      "\n\n🆘 General Alves CEO foi acionado."
    );
  } else if (score < 80 && problemas.length > 0) {
    await enviarTelegram(
      `👥 *CAPITÃ CLIENTES — Atenção*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `⚠️ ${p}`).join("\n")
    );
  }

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
    VALUES ('gerente-clientes', 'consolidar_clientes', ${score >= 70 ? "sucesso" : "aviso"},
      ${JSON.stringify({ score, problemas })}, ${Date.now() - inicio})
  `.catch(() => {});

  return NextResponse.json({ ok: score >= 70, score, problemas });
}
