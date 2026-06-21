/**
 * MARCOS MRR — Monitora o MRR e detecta quedas semanais
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const VALOR_PLANO: Record<string, number> = {
  vip: 9.9,
  elite: 19.9,
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // 1. MRR atual por plano (status ativo ou trial)
    // IMPORTANTE: assinaturas anuais guardam o valor cheio do ano em `valor` (ex: R$99,
    // R$199) — sem normalizar por `ciclo`, SUM(valor) trata isso como receita MENSAL e
    // superestima o MRR em até 12x. Normaliza dividindo por 12 quando ciclo = 'anual'.
    const assinaturasAtivas = await sql`
      SELECT plano, COUNT(*) as total,
             SUM(CASE WHEN ciclo = 'anual' THEN valor / 12.0 ELSE valor END) as soma
      FROM assinaturas
      WHERE status = 'ativa'
      GROUP BY plano
    `;

    const trialsAtivos = await sql`
      SELECT plano, COUNT(*) as total
      FROM usuarios
      WHERE status = 'trial'
        AND trial_fim >= NOW()
        AND plano IS NOT NULL
      GROUP BY plano
    `;

    const porPlano: Record<string, { assinantes: number; mrr: number }> = {};

    for (const row of assinaturasAtivas) {
      const plano = String(row.plano);
      porPlano[plano] = {
        assinantes: Number(row.total),
        mrr: Number(row.soma),
      };
    }

    // Trials contam para MRR com valor do plano (assumindo conversão)
    for (const row of trialsAtivos) {
      const plano = String(row.plano);
      const qtd = Number(row.total);
      const valorUnit = VALOR_PLANO[plano] ?? 0;
      if (!porPlano[plano]) porPlano[plano] = { assinantes: 0, mrr: 0 };
      porPlano[plano].assinantes += qtd;
      porPlano[plano].mrr += qtd * valorUnit;
    }

    const mrrAtual = Object.values(porPlano).reduce((acc, v) => acc + v.mrr, 0);
    const totalAssinantes = Object.values(porPlano).reduce((acc, v) => acc + v.assinantes, 0);

    // 2. MRR da semana passada (snapshot em agentes_log)
    const snapshotAnterior = await sql`
      SELECT detalhes FROM agentes_log
      WHERE agente = 'marcos-mrr'
        AND acao = 'mrr_snapshot'
        AND status = 'sucesso'
        AND created_at >= NOW() - INTERVAL '8 days'
        AND created_at <= NOW() - INTERVAL '5 days'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const mrrAnterior: number | null =
      snapshotAnterior.length > 0
        ? Number((snapshotAnterior[0].detalhes as Record<string, unknown>)?.mrr_total ?? 0)
        : null;

    let quedaPercent: number | null = null;
    if (mrrAnterior && mrrAnterior > 0) {
      quedaPercent = ((mrrAtual - mrrAnterior) / mrrAnterior) * 100;
    }

    // 3. Novos assinantes nas últimas 24h
    const novos = await sql`
      SELECT COUNT(*) as total FROM usuarios
      WHERE created_at >= NOW() - INTERVAL '24 hours'
        AND status IN ('ativo', 'trial')
    `;

    // 4. Cancelamentos nas últimas 24h
    const cancelamentos = await sql`
      SELECT COUNT(*) as total FROM usuarios
      WHERE status = 'cancelado'
        AND updated_at >= NOW() - INTERVAL '24 hours'
    `;

    const qtdNovos = Number(novos[0].total);
    const qtdCancelamentos = Number(cancelamentos[0].total);

    // 5. Alertas por queda
    if (quedaPercent !== null && quedaPercent < 0) {
      const abs = Math.abs(quedaPercent);
      const nivel = abs > 20 ? "🚨" : "🔴";
      const severidade = abs > 20 ? "crítica" : "alta";

      const linhasPlanos = Object.entries(porPlano)
        .map(([p, v]) => `• ${p.charAt(0).toUpperCase() + p.slice(1)}: ${v.assinantes} assinantes → R$ ${formatBRL(v.mrr)}`)
        .join("\n");

      // FASE 17: este cron roda a cada 30min — sem dedup, enquanto a queda persistia
      // gerava um alerta novo (e um Telegram novo) a cada execução, várias vezes por hora.
      const { criado } = await criarAlertaDedup(
        "mrr_queda",
        abs > 20 ? "critico" : "alto",
        `MRR caiu ${abs.toFixed(1)}% em relação à semana passada (R$ ${formatBRL(mrrAnterior!)} → R$ ${formatBRL(mrrAtual)})`
      );

      if (criado) {
        await alertarTelegram(
          nivel,
          `MARCOS MRR — Queda ${severidade.toUpperCase()} detectada`,
          `📉 MRR atual: R$ ${formatBRL(mrrAtual)}\nMRR semana passada: R$ ${formatBRL(mrrAnterior!)}\nQueda: -${abs.toFixed(1)}% ⚠️\n\nPor plano:\n${linhasPlanos}\n\nCancelamentos 24h: ${qtdCancelamentos}`
        );
      }
    }

    // 6. Salva snapshot atual
    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'marcos-mrr',
        'mrr_snapshot',
        'sucesso',
        ${JSON.stringify({
          mrr_total: mrrAtual,
          total_assinantes: totalAssinantes,
          por_plano: porPlano,
          mrr_anterior: mrrAnterior,
          snapshot_anterior_encontrado: snapshotAnterior.length > 0,
          queda_percent: quedaPercent,
          novos_24h: qtdNovos,
          cancelamentos_24h: qtdCancelamentos,
        })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: true,
      mrr_atual: mrrAtual,
      mrr_semana_passada: mrrAnterior,
      queda_percent: quedaPercent,
      total_assinantes: totalAssinantes,
      por_plano: porPlano,
      novos_24h: qtdNovos,
      cancelamentos_24h: qtdCancelamentos,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "MARCOS MRR — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
