/**
 * FISCAL PEDRO PERFORMANCE — Fiscal de Performance
 * Mede latência do banco, taxa de erros, backlog de filas e falhas consecutivas.
 * Envia alerta direto no Telegram ao Vovó Teresinha Bot.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { alertarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const alertas: string[] = [];
  let latencia = 0;

  try {
    // 1. Latência do banco de dados
    const inicio = Date.now();
    await sql`SELECT 1`;
    latencia = Date.now() - inicio;
    if (latencia > 3000) {
      alertas.push(`DB com latência crítica: ${latencia}ms (limite: 3000ms)`);
    } else if (latencia > 1500) {
      alertas.push(`DB com latência elevada: ${latencia}ms (atenção: >1500ms)`);
    }

    // 2. Taxa de erros nas últimas 2h
    const [falhasAbertas] = await sql`
      SELECT COUNT(*)::int AS total FROM falhas_agentes
      WHERE resolvido = false AND criado_em > NOW() - INTERVAL '2 hours'
    `;
    const [totalFalhas] = await sql`
      SELECT COUNT(*)::int AS total FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '2 hours'
    `;
    const taxaErro = Number(totalFalhas.total) > 0
      ? (Number(falhasAbertas.total) / Number(totalFalhas.total)) * 100
      : 0;
    if (taxaErro > 50) {
      alertas.push(`Taxa de erros crítica: ${taxaErro.toFixed(0)}% nas últimas 2h`);
    } else if (taxaErro > 30) {
      alertas.push(`Taxa de erros elevada: ${taxaErro.toFixed(0)}% nas últimas 2h`);
    }

    // 3. Fila WhatsApp represada
    const [filaWpp] = await sql`
      SELECT COUNT(*)::int AS total FROM whatsapp_fila WHERE status = 'pendente'
    `;
    if (Number(filaWpp.total) > 200) {
      alertas.push(`Fila WhatsApp crítica: ${filaWpp.total} mensagens pendentes`);
    }

    // 4. Agentes com 5+ falhas consecutivas abertas nas últimas 2h
    const consecutivas = await sql`
      SELECT agente, COUNT(*)::int AS total FROM falhas_agentes
      WHERE resolvido = false AND criado_em > NOW() - INTERVAL '2 hours'
      GROUP BY agente HAVING COUNT(*) >= 5
      ORDER BY total DESC LIMIT 5
    ` as { agente: string; total: number }[];
    if (consecutivas.length > 0) {
      const lista = consecutivas.map(r => `${r.agente}(${r.total}x)`).join(", ");
      alertas.push(`Agentes com 5+ falhas abertas: ${lista}`);
    }

    // 5. Backlog total de falhas abertas (performance do banco)
    const [backlogTotal] = await sql`
      SELECT COUNT(*)::int AS total FROM falhas_agentes WHERE resolvido = false
    `;
    if (Number(backlogTotal.total) > 500) {
      alertas.push(`Backlog de falhas excessivo: ${backlogTotal.total} registros abertos (limpar com limpador-dados)`);
    }

    // 6. Push subscriptions inativas acumuladas (peso desnecessário)
    const [pushInativas] = await sql`
      SELECT COUNT(*)::int AS total FROM push_subscriptions WHERE ativo = false
    `;
    if (Number(pushInativas.total) > 1000) {
      alertas.push(`${pushInativas.total} push subscriptions inativas acumuladas (executar limpador-dados)`);
    }

    if (alertas.length > 0) {
      for (const a of alertas) {
        await reportarFalha("fiscal-codigo-performance", a, { severidade: "alto" });
      }
      await alertarTelegram(
        "📊",
        "FISCAL PERFORMANCE — ALERTAS",
        alertas.map(a => `⚠️ ${a}`).join("\n") + `\n\nLatência DB: ${latencia}ms`
      );
    } else {
      await resolverFalhas("fiscal-codigo-performance");
    }

    return NextResponse.json({
      ok: alertas.length === 0,
      alertas,
      latencia_ms: latencia,
      falhas_abertas: Number(falhasAbertas?.total ?? 0),
    });
  } catch (err) {
    await alertarTelegram("🔴", "FISCAL PERFORMANCE — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
