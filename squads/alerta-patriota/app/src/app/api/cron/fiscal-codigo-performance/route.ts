/**
 * FISCAL CÓDIGO — PERFORMANCE
 * Monitora latência do banco, tamanho do backlog, taxa de erros dos agentes.
 * Roda a cada 6h. Alerta se métricas estão degradadas.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const alertas: string[] = [];

  try {
    // 1. Latência do banco
    const t0 = Date.now();
    await sql`SELECT 1`;
    const latenciaDB = Date.now() - t0;
    if (latenciaDB > 3000) alertas.push(`DB lento: ${latenciaDB}ms (esperado <3000ms)`);

    // 2. Backlog de resumo (notícias sem resumo acima de 200 é crítico)
    const backlog = await sql`SELECT COUNT(*) as total FROM noticias WHERE resumo_braga IS NULL`;
    const backlogN = Number(backlog[0].total);
    if (backlogN > 500) alertas.push(`Backlog crítico: ${backlogN} notícias sem resumo`);
    else if (backlogN > 200) alertas.push(`Backlog alto: ${backlogN} notícias sem resumo`);

    // 3. Taxa de erros dos agentes nas últimas 6h
    const [erros, total] = await Promise.all([
      sql`SELECT COUNT(*) as total FROM agentes_log WHERE status = 'erro' AND created_at >= NOW() - INTERVAL '6 hours'`,
      sql`SELECT COUNT(*) as total FROM agentes_log WHERE created_at >= NOW() - INTERVAL '6 hours'`,
    ]);
    const taxaErro = Number(total[0].total) > 0 ? Number(erros[0].total) / Number(total[0].total) : 0;
    if (taxaErro > 0.3) alertas.push(`Taxa de erro alta: ${Math.round(taxaErro * 100)}% nas últimas 6h (${erros[0].total}/${total[0].total})`);

    // 4. Agentes com múltiplas falhas consecutivas (possível loop de erro)
    // Janela menor (2h) que a taxa de erro geral (6h) propositalmente: um loop de
    // erro precisa ser detectado rápido, enquanto a taxa geral mede degradação ao longo do dia.
    const falhasConsecutivas = await sql`
      SELECT agente, COUNT(*) as falhas
      FROM agentes_log
      WHERE status = 'erro' AND created_at >= NOW() - INTERVAL '2 hours'
      GROUP BY agente
      HAVING COUNT(*) >= 5
      ORDER BY falhas DESC
      LIMIT 5
    `;
    for (const row of falhasConsecutivas) {
      alertas.push(`Loop de erro: ${row.agente} falhou ${row.falhas}x nas últimas 2h`);
    }

    // 5. Tamanho total de agentes_log (se muito grande, pode degradar queries)
    const logSize = await sql`SELECT COUNT(*) as total FROM agentes_log`;
    const logN = Number(logSize[0].total);
    if (logN > 100000) alertas.push(`Tabela agentes_log grande: ${logN} registros — considere limpeza`);

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('fiscal-codigo-performance', 'verificar_performance',
        ${alertas.length === 0 ? "sucesso" : "aviso"},
        ${JSON.stringify({ latenciaDB, backlogN, taxaErro: Math.round(taxaErro * 100), logN, alertas })},
        ${duracao})
    `;

    if (alertas.length > 0) {
      await alertarTelegram("🟡", `FISCAL CÓDIGO — PERFORMANCE DEGRADADA (${alertas.length})`,
        alertas.map(a => `• ${a}`).join("\n")
      );
    }

    return NextResponse.json({ ok: alertas.length === 0, latenciaDB, backlogN, taxaErroPercent: Math.round(taxaErro * 100), alertas });
  } catch (err) {
    await alertarTelegram("🚨", "FISCAL CÓDIGO PERFORMANCE — ERRO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
