/**
 * FISCAL BRUNA BANCO — Verifica conexão Neon a cada 10 min
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // Health check básico
    await sql`SELECT 1 as ok`;
    const latencia = Date.now() - inicio;

    // Verifica queries lengas
    const lengas = await sql`
      SELECT count(*) as total FROM pg_stat_activity
      WHERE state = 'active' AND now() - query_start > interval '30 seconds'
    `;
    const qtdLengas = Number(lengas[0].total);

    if (latencia > 5000) {
      const { criado } = await criarAlertaDedup("fiscal_banco", "alto", `Latência ${latencia}ms`);
      if (criado) {
        await alertarTelegram("🔴", "Fiscal Bruna Banco — BANCO LENTO", `Latência: ${latencia}ms`);
      }
    } else if (qtdLengas > 0) {
      // FASE 23: faltava dedup aqui — esse cron roda a cada 10min, então uma query longa
      // que persistisse por horas gerava um alerta Telegram novo a cada execução.
      const { criado: queryLengaCriado } = await criarAlertaDedup("fiscal_banco_query_lenga", "medio", `${qtdLengas} query(s) rodando há +30s`);
      if (queryLengaCriado) {
        await alertarTelegram("🟡", "Fiscal Bruna Banco — Query longa detectada", `${qtdLengas} query(s) rodando há +30s`);
      }
    } else {
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms) VALUES ('bruna-banco', 'health_check', 'sucesso', '{}', ${latencia})`;
    }

    return NextResponse.json({ ok: true, latencia_ms: latencia, queries_lengas: qtdLengas });
  } catch (err) {
    const { criado } = await criarAlertaDedup("fiscal_banco", "critico", "Banco Neon não responde").catch(() => ({ criado: false }));
    if (criado) {
      await alertarTelegram("🚨", "Fiscal Bruna Banco — BANCO FORA DO AR", String(err));
    }
    return NextResponse.json({ erro: "Banco fora do ar", detalhe: String(err) }, { status: 503 });
  }
}
