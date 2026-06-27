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

  // 2. Variação de membros nos grupos (usa as variações já calculadas pelo carlos-cargo)
  try {
    const snapAnterior = await sql`
      SELECT detalhes FROM agentes_log
      WHERE agente = 'carlos-cargo' AND acao = 'membros_snapshot'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (snapAnterior.length > 0) {
      const detalhes = (snapAnterior[0] as { detalhes: { variacoes?: Array<{ nome: string; plano: string; variacao_percent: number; critico: boolean; alerta: boolean }> } }).detalhes;
      const variacoes = detalhes?.variacoes ?? [];
      for (const v of variacoes) {
        const queda = -v.variacao_percent;
        if (v.critico || queda > 20) { problemas.push(`Grupo ${v.plano}: queda de ${queda.toFixed(0)}% de membros`); score -= 20; }
        else if (v.alerta || queda > 10) { problemas.push(`Grupo ${v.plano}: queda de ${queda.toFixed(0)}% de membros`); score -= 10; }
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
  // FASE 27.5: lia só o status da última linha, sem checar há quanto tempo foi gravada —
  // bot-responder só grava log quando responde alguma pergunta (whatsapp_fila não-vazia),
  // então um log antigo de 'sucesso' satisfazia esta checagem para sempre, mesmo que o cron
  // tivesse parado de rodar. 24h (bem mais generoso que o limite de 2h do Agente Médico, que
  // é um heartbeat de fato periódico) porque dias de baixa atividade no grupo sem perguntas
  // são normais e não devem disparar falso alarme (ver agente-heartbeat/route.ts:17-26).
  try {
    const botLog = await sql`
      SELECT status, created_at FROM agentes_log
      WHERE agente = 'bot-responder'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (botLog.length === 0) { problemas.push("Bot Responder nunca executou"); score -= 5; }
    else {
      const ultimo = botLog[0] as { status: string; created_at: string };
      const diffH = (Date.now() - new Date(ultimo.created_at).getTime()) / 3_600_000;
      if (ultimo.status === "erro") { problemas.push("Bot Responder com erro"); score -= 10; }
      else if (diffH > 24) { problemas.push(`Bot Responder sem atividade há ${diffH.toFixed(0)}h`); score -= 5; }
    }
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
