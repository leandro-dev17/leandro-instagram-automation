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

    // FASE 27.5: o INSERT em agentes_log só acontecia no branch "tudo certo" (else) —
    // latência alta e query lenga só gravavam em `alertas` (com dedup), nunca em
    // agentes_log. Quem lê agentes_log para julgar a saúde de 'bruna-banco' (gerente-
    // tecnico/route.ts:43 conta erros desse agente; agente-heartbeat lê a última linha)
    // via essa fonte enxergava o agente como "nunca falhou"/"parado" justamente nos
    // períodos em que ele estava mais ativo detectando degradação. Agora grava em todos
    // os 3 caminhos, com status refletindo a severidade real.
    if (latencia > 5000) {
      const { criado } = await criarAlertaDedup("fiscal_banco", "alto", `Latência ${latencia}ms`);
      if (criado) {
        await alertarTelegram("🔴", "Fiscal Bruna Banco — BANCO LENTO", `Latência: ${latencia}ms`);
      }
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms) VALUES ('bruna-banco', 'health_check', 'erro', ${JSON.stringify({ motivo: "latencia_alta", latencia })}, ${latencia})`.catch(() => {});
    } else if (qtdLengas > 0) {
      // FASE 23: faltava dedup aqui — esse cron roda a cada 10min, então uma query longa
      // que persistisse por horas gerava um alerta Telegram novo a cada execução.
      const { criado: queryLengaCriado } = await criarAlertaDedup("fiscal_banco_query_lenga", "medio", `${qtdLengas} query(s) rodando há +30s`);
      if (queryLengaCriado) {
        await alertarTelegram("🟡", "Fiscal Bruna Banco — Query longa detectada", `${qtdLengas} query(s) rodando há +30s`);
      }
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms) VALUES ('bruna-banco', 'health_check', 'aviso', ${JSON.stringify({ motivo: "query_lenga", qtdLengas })}, ${latencia})`.catch(() => {});
    } else {
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms) VALUES ('bruna-banco', 'health_check', 'sucesso', '{}', ${latencia})`;
    }

    return NextResponse.json({ ok: true, latencia_ms: latencia, queries_lengas: qtdLengas });
  } catch (err) {
    // Item 6 (Fase 33): `criarAlertaDedup` também consulta o banco — se o banco estiver
    // mesmo fora do ar (o caso que este catch existe para cobrir), o dedup falha junto e
    // o `.catch` original (`{ criado: false }`) fazia o código achar que já tinha alertado,
    // silenciando justo o cenário mais crítico. Tratando a falha do dedup como "não duplicado"
    // (`criado: true`) aceita o risco de Telegram repetido durante a queda em troca de nunca
    // ficar em silêncio total.
    const { criado } = await criarAlertaDedup("fiscal_banco", "critico", "Banco Neon não responde").catch(() => ({ criado: true }));
    if (criado) {
      await alertarTelegram("🚨", "Fiscal Bruna Banco — BANCO FORA DO AR", String(err));
    }
    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('bruna-banco', 'health_check', 'erro', ${JSON.stringify({ erro: String(err) })})`.catch(() => {});
    return NextResponse.json({ erro: "Banco fora do ar", detalhe: String(err) }, { status: 503 });
  }
}
