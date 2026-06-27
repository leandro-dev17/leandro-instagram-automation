import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { calcularMRR } from "@/lib/mrr";

export async function GET() {
  try {
    await requireAdmin();

    const [membros, { mrrTotal }, receitaTotalRows, grupos, noticias, agentes] = await Promise.all([
      // Membros por plano e status
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ativo') as ativos,
          COUNT(*) FILTER (WHERE status = 'trial') as trial,
          COUNT(*) FILTER (WHERE status = 'inadimplente') as inadimplentes,
          COUNT(*) FILTER (WHERE status = 'cancelado') as cancelados,
          COUNT(*) FILTER (WHERE plano = 'vip' AND status = 'ativo') as vip,
          COUNT(*) FILTER (WHERE plano = 'elite' AND status = 'ativo') as elite,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as novos_hoje,
          COUNT(*) FILTER (WHERE status = 'cancelado' AND updated_at >= NOW() - INTERVAL '24 hours') as cancelados_hoje
        FROM usuarios
      `,
      // MRR real — fonte única (lib/mrr.ts), não mais preço hardcoded por plano/ciclo
      calcularMRR(),
      sql`SELECT SUM(valor) as receita_total FROM assinaturas WHERE status = 'ativa'`,
      // Status dos grupos
      sql`SELECT nome, plano, membros_ativos, max_membros, ativo FROM grupos_whatsapp ORDER BY plano`,
      // Notícias das últimas 24h
      sql`
        SELECT COUNT(*) as total_24h,
               COUNT(*) FILTER (WHERE urgente = true) as urgentes_24h
        FROM noticias WHERE created_at >= NOW() - INTERVAL '24 hours'
      `,
      // Últimos logs dos agentes (erros recentes)
      sql`
        SELECT agente, acao, status, created_at
        FROM agentes_log
        WHERE status = 'erro' AND created_at >= NOW() - INTERVAL '24 hours'
        ORDER BY created_at DESC LIMIT 10
      `,
    ]);

    return NextResponse.json({
      membros: membros[0],
      financeiro: { mrr_estimado: mrrTotal, receita_total: Number(receitaTotalRows[0].receita_total) },
      grupos,
      noticias: noticias[0],
      erros_recentes: agentes,
    });
  } catch (err) {
    if (String(err).includes("Acesso negado")) {
      return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    }
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
