/**
 * CORONEL TÉCNICO — Gerente de Infraestrutura
 * Consolida saúde do sistema: banco, API, WhatsApp, GitHub, APIs externas.
 * Score 0-100. Se < 50 → escala para CEO.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

const AGENTES_TECNICOS = [
  "fiscal-login", "fiscal-api", "fiscal-whatsapp", "fiscal-banco",
  "fiscal-facebook", "guardiao-seguranca", "backup", "agente-medico",
  "fila-dlq", "carlos-disjuntor", "arturo-apis", "max-memoria", "wagner-workflow",
];

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const problemas: string[] = [];
  let score = 100;

  // 1. Saúde do banco (latência)
  try {
    const t = Date.now();
    await sql`SELECT 1`;
    const lat = Date.now() - t;
    if (lat > 3000) { problemas.push(`Banco lento: ${lat}ms`); score -= 20; }
    else if (lat > 1000) { problemas.push(`Banco com latência elevada: ${lat}ms`); score -= 5; }
  } catch { problemas.push("Banco INDISPONÍVEL"); score -= 40; }

  // 2. Falhas não resolvidas nas últimas 4h dos agentes técnicos
  try {
    const falhas = await sql`
      SELECT agente, COUNT(*) as total FROM agentes_log
      WHERE agente = ANY(${AGENTES_TECNICOS})
        AND status = 'erro'
        AND created_at > NOW() - INTERVAL '4 hours'
      GROUP BY agente
      ORDER BY total DESC
    `;
    for (const f of falhas) {
      const total = parseInt((f as { total: string }).total);
      if (total >= 3) { problemas.push(`${f.agente}: ${total} erros nas últimas 4h`); score -= 10; }
    }
  } catch { /* silencioso */ }

  // 3. Alertas críticos de infraestrutura abertos
  try {
    const alertasCriticos = await sql`
      SELECT COUNT(*) as total FROM alertas
      WHERE tipo IN ('cards_sem_envio', 'cards_com_erro', 'workflow_falhando', 'workflow_erro_api')
        AND resolvido = false
        AND created_at > NOW() - INTERVAL '6 hours'
    `;
    const n = parseInt((alertasCriticos[0] as { total: string }).total);
    if (n > 0) { problemas.push(`${n} alertas críticos de infra abertos`); score -= 15 * Math.min(n, 3); }
  } catch { /* silencioso */ }

  // 4. Agente médico ativo? (deve ter rodado nas últimas 2h)
  try {
    const medico = await sql`
      SELECT status FROM agentes_log
      WHERE agente = 'agente-medico'
      ORDER BY created_at DESC LIMIT 1
    `;
    if (medico.length === 0) { problemas.push("Agente Médico nunca executou"); score -= 10; }
    else if ((medico[0] as { status: string }).status === "erro") { problemas.push("Agente Médico com erro"); score -= 15; }
  } catch { /* silencioso */ }

  // ── ESCALONAMENTO ────────────────────────────────────────────────────────
  if (score < 50) {
    // Critico → escala para CEO
    await fetch(`${APP_URL}/api/cron/relatorio-ceo?origem=gerente-tecnico&score=${score}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(8000),
    }).catch(() => {});

    await enviarTelegram(
      `⚙️ *CORONEL TÉCNICO — SITUAÇÃO CRÍTICA*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `❌ ${p}`).join("\n") +
      "\n\n🆘 General Alves CEO foi acionado."
    );
  } else if (score < 80 && problemas.length > 0) {
    await enviarTelegram(
      `⚙️ *CORONEL TÉCNICO — Atenção*\n\nScore: ${score}/100\n\n` +
      problemas.map(p => `⚠️ ${p}`).join("\n")
    );
  }

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
    VALUES ('gerente-tecnico', 'consolidar_infra', ${score >= 70 ? "sucesso" : "aviso"},
      ${JSON.stringify({ score, problemas })}, ${Date.now() - inicio})
  `.catch(() => {});

  return NextResponse.json({ ok: score >= 70, score, problemas });
}
