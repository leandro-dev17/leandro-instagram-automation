/**
 * REVISOR DE LÓGICA (Nível 3)
 * Acionado pelo fiscal-codigo-logica.
 * Tenta autocorrigir: limpar alertas acumulados, resetar agentes travados.
 * Escala para gerente-codigo com diagnóstico completo.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const acoes: string[] = [];

  try {
    const alertasLogica = await sql`
      SELECT id, mensagem FROM alertas
      WHERE tipo = 'codigo_logica' AND resolvido = false
      AND created_at >= NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC LIMIT 10
    `;

    if (alertasLogica.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas de lógica pendentes" });
    }

    for (const alerta of alertasLogica) {
      const msg = (alerta.mensagem as string).toLowerCase();

      // FASE 17: removida a "Autocorreção 1" que marcava alertas críticos como
      // resolvido=true apenas por terem passado de 2h, sem checar se a causa real
      // foi corrigida — isso escondia o sintoma (o próprio alerta existe para
      // sinalizar que algo ficou sem resolução) em vez de corrigi-lo. Esse tipo de
      // alerta agora apenas segue para a escalação ao gerente-codigo no fim da rota.

      // Autocorreção 2: pipeline parado → dispara coletor manualmente
      if (msg.includes("nenhuma notícia coletada") || msg.includes("coletor pode estar parado")) {
        const r = await fetch(`${APP}/api/cron/coletar-noticias`, {
          headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(30000),
        }).catch(() => null);
        acoes.push(r?.ok ? "✅ Coletor de notícias disparado manualmente" : "❌ Falha ao disparar coletor");
      }

      // Autocorreção 3: resumidor parado → dispara resumidor
      if (msg.includes("resumidor parado")) {
        const r = await fetch(`${APP}/api/cron/resumir-noticias`, {
          headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(30000),
        }).catch(() => null);
        acoes.push(r?.ok ? "✅ Resumidor disparado manualmente" : "❌ Falha ao disparar resumidor");
      }

      // Autocorreção 4: duplicatas → limpa posts duplicados recentes
      if (msg.includes("publicações duplicadas")) {
        acoes.push("⚠️ Duplicatas detectadas — requer análise manual do gerente de código");
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('revisor-logica', 'corrigir_logica', ${acoes.some(a => a.startsWith("✅")) ? "sucesso" : "aviso"},
        ${JSON.stringify({ alertas: alertasLogica.length, acoes })},
        ${Date.now() - inicio})
    `;

    await alertarTelegram(
      acoes.some(a => a.startsWith("✅")) ? "🟢" : "🟡",
      `REVISOR LÓGICA — ${alertasLogica.length} problema(s), ${acoes.filter(a => a.startsWith("✅")).length} corrigido(s)`,
      acoes.join("\n") + "\n\n⚠️ Escalando para Gerente de Código..."
    );

    // Sempre escala para gerente-codigo quando há problemas de lógica
    await fetch(`${APP}/api/cron/gerente-codigo`, {
      headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    return NextResponse.json({ ok: true, alertas: alertasLogica.length, acoes });
  } catch (err) {
    await alertarTelegram("🚨", "REVISOR LÓGICA — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
