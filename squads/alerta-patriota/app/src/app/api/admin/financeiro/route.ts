import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { calcularMRR } from "@/lib/mrr";

export async function GET() {
  try {
    await requireAdmin();

    const [{ porPlano, mrrTotal, totalAssinantes }, receita, inadimplentes, cancelamentos, crescimento] = await Promise.all([
      // FASE 27.3: usa a fonte única de MRR (lib/mrr.ts) em vez de uma query local —
      // mesma lógica (valor real da assinatura, anual normalizado /12) que antes só
      // existia duplicada aqui e em fiscal-mrr/route.ts.
      calcularMRR(),
      sql`
        SELECT
          SUM(valor) FILTER (WHERE created_at >= NOW() - INTERVAL '30 days') as mes_atual,
          SUM(valor) FILTER (WHERE created_at >= NOW() - INTERVAL '60 days'
                             AND created_at < NOW() - INTERVAL '30 days') as mes_anterior,
          SUM(valor) as total_historico
        FROM pagamentos WHERE status = 'aprovado'
      `,
      sql`
        SELECT id, nome, email, plano, updated_at
        FROM usuarios WHERE status = 'inadimplente'
        ORDER BY updated_at DESC LIMIT 20
      `,
      sql`
        SELECT COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '30 days') as mes_atual,
               COUNT(*) FILTER (WHERE updated_at >= NOW() - INTERVAL '60 days'
                                AND updated_at < NOW() - INTERVAL '30 days') as mes_anterior
        FROM usuarios WHERE status = 'cancelado'
      `,
      sql`
        SELECT DATE_TRUNC('day', created_at) as dia,
               COUNT(*) as novos
        FROM usuarios
        WHERE created_at >= NOW() - INTERVAL '30 days'
        GROUP BY 1 ORDER BY 1
      `,
    ]);

    return NextResponse.json({
      mrr: { mrr: mrrTotal, total_ativas: totalAssinantes, por_plano: porPlano },
      receita: receita[0],
      inadimplentes,
      cancelamentos: cancelamentos[0],
      crescimento,
    });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
