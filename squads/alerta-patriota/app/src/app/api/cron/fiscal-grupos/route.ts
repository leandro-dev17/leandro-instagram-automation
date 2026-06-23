/**
 * CARLOS CARGO — Monitora variação de membros nos grupos WhatsApp
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

interface GrupoSnapshot {
  id: number;
  membros: number;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // 1. Membros atuais por grupo
    // Monitora apenas os grupos ativos VIP e Elite (grupos descontinuados ficam de fora)
    const grupos = await sql`
      SELECT id, nome, plano, membros_ativos, max_membros
      FROM grupos_whatsapp
      WHERE ativo = true AND plano IN ('vip', 'elite')
      ORDER BY plano, nome
    `;

    // 2. Snapshot anterior (< 6h atrás)
    const snapshotRow = await sql`
      SELECT detalhes FROM agentes_log
      WHERE agente = 'carlos-cargo'
        AND acao = 'membros_snapshot'
        AND status = 'sucesso'
        AND created_at >= NOW() - INTERVAL '6 hours'
      ORDER BY created_at DESC
      LIMIT 1
    `;

    const snapshotAnterior: GrupoSnapshot[] =
      snapshotRow.length > 0
        ? ((snapshotRow[0].detalhes as Record<string, unknown>)?.grupos as GrupoSnapshot[]) ?? []
        : [];

    const snapshotMap = new Map<number, number>(snapshotAnterior.map((g) => [g.id, g.membros]));

    // 3. Calcula variação por grupo
    const variacoes: Array<{
      id: number;
      nome: string;
      plano: string;
      membros_anterior: number | null;
      membros_atual: number;
      variacao: number | null;
      variacao_percent: number | null;
      alerta: boolean;
      critico: boolean;
    }> = [];

    const alertas: string[] = [];
    let temCritico = false;
    let temAlto = false;

    for (const g of grupos) {
      const atual = Number(g.membros_ativos);
      const anterior = snapshotMap.has(Number(g.id)) ? snapshotMap.get(Number(g.id))! : null;
      const variacao = anterior !== null ? atual - anterior : null;
      const variacaoPercent = anterior !== null && anterior > 0 ? ((atual - anterior) / anterior) * 100 : null;

      const alerta = variacaoPercent !== null && variacaoPercent < -10;
      const critico = variacaoPercent !== null && variacaoPercent < -25;

      if (alerta) {
        const emoji = critico ? "🚨" : "⚠️";
        alertas.push(
          `${emoji} Grupo ${g.nome}: ${anterior} → ${atual} membros (${variacaoPercent!.toFixed(1)}%)`
        );
        if (critico) temCritico = true;
        else temAlto = true;
      }

      variacoes.push({
        id: Number(g.id),
        nome: String(g.nome),
        plano: String(g.plano),
        membros_anterior: anterior,
        membros_atual: atual,
        variacao,
        variacao_percent: variacaoPercent !== null ? Math.round(variacaoPercent * 10) / 10 : null,
        alerta,
        critico,
      });
    }

    // 4. Dispara alertas
    if (alertas.length > 0) {
      const nivel = temCritico ? "🚨" : "🔴";

      const { criado } = await criarAlertaDedup(
        "queda_membros",
        temCritico ? "critico" : "alto",
        `${alertas.length} grupo(s) com queda significativa de membros`
      );

      if (criado) {
        await alertarTelegram(
          nivel,
          "CARLOS CARGO — Queda de Membros!",
          `👥 ${alertas.join("\n")}\n\nInvestigar possível problema de conteúdo ou pagamento.`
        );
      }
    }

    // 5. Salva novo snapshot
    const duracao = Date.now() - inicio;
    const snapshotAtual: GrupoSnapshot[] = grupos.map((g) => ({
      id: Number(g.id),
      membros: Number(g.membros_ativos),
    }));

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'carlos-cargo',
        'membros_snapshot',
        ${alertas.length > 0 ? "aviso" : "sucesso"},
        ${JSON.stringify({
          grupos: snapshotAtual,
          variacoes,
          alertas_disparados: alertas.length,
        })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: alertas.length === 0,
      grupos_monitorados: grupos.length,
      alertas_disparados: alertas.length,
      tem_critico: temCritico,
      tem_alto: temAlto,
      variacoes,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "CARLOS CARGO — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
