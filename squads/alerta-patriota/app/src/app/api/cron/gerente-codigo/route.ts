/**
 * GERENTE DE CÓDIGO (Nível 2)
 * Consolida relatórios de todos os revisores.
 * Decide se chama o Claude Revisor ou se é só um aviso.
 * Envia relatório consolidado para Telegram.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  // Dedup: não roda mais de 1x a cada 30min
  const recente = await sql`
    SELECT id FROM agentes_log WHERE agente = 'gerente-codigo'
    AND created_at > NOW() - INTERVAL '30 minutes' LIMIT 1
  `;
  if (recente.length > 0) return NextResponse.json({ ok: true, motivo: "Executado recentemente" });

  const inicio = Date.now();

  try {
    // Consolida todos os alertas de código não resolvidos nas últimas 4h
    const alertasCodigo = await sql`
      SELECT tipo, severidade, mensagem, created_at
      FROM alertas
      WHERE tipo IN ('codigo_seguranca', 'codigo_schema', 'codigo_logica')
      AND resolvido = false
      AND created_at >= NOW() - INTERVAL '4 hours'
      ORDER BY
        CASE severidade WHEN 'critico' THEN 0 WHEN 'alto' THEN 1 ELSE 2 END,
        created_at DESC
      LIMIT 20
    `;

    const criticos = alertasCodigo.filter(a => a.severidade === "critico");
    const altos = alertasCodigo.filter(a => a.severidade === "alto");
    const medios = alertasCodigo.filter(a => a.severidade === "medio");

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('gerente-codigo', 'consolidar_relatorio',
        ${alertasCodigo.length === 0 ? "sucesso" : "aviso"},
        ${JSON.stringify({ criticos: criticos.length, altos: altos.length, medios: medios.length })},
        ${Date.now() - inicio})
    `;

    if (alertasCodigo.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Nenhum alerta de código pendente" });
    }

    // Monta relatório consolidado
    const relatorio = `
📋 *GERENTE DE CÓDIGO — RELATÓRIO CONSOLIDADO*
${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}

🚨 Críticos: ${criticos.length} | 🔴 Altos: ${altos.length} | 🟡 Médios: ${medios.length}

${criticos.length > 0 ? `*CRÍTICOS:*\n${criticos.map(a => `• [${a.tipo}] ${a.mensagem}`).join("\n")}` : ""}
${altos.length > 0 ? `\n*ALTOS:*\n${altos.slice(0, 3).map(a => `• [${a.tipo}] ${a.mensagem}`).join("\n")}` : ""}
`.trim();

    await enviarTelegram(relatorio);

    // Se há críticos ou altos, chama o Claude Revisor
    if (criticos.length > 0 || altos.length > 0) {
      await alertarTelegram("🤖", "GERENTE CÓDIGO → CHAMANDO CLAUDE REVISOR",
        `${criticos.length + altos.length} problema(s) crítico/alto requerem correção automática de código.`
      );

      await fetch(`${APP}/api/cron/claude-revisor`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.CLAUDE_AUTOFIX_SECRET || CRON}` },
        body: JSON.stringify({ alertas: alertasCodigo.slice(0, 5) }),
        signal: AbortSignal.timeout(10000),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, criticos: criticos.length, altos: altos.length, medios: medios.length });
  } catch (err) {
    await alertarTelegram("🚨", "GERENTE CÓDIGO — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
