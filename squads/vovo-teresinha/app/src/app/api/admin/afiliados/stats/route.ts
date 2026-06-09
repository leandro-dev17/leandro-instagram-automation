import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const [totalAfiliados, totalComissoes, saquesPendentes, topAfiliados] = await Promise.all([
      sql`SELECT COUNT(*) as count FROM afiliados`,
      sql`SELECT status, COALESCE(SUM(valor), 0) as total FROM comissoes GROUP BY status`,
      sql`SELECT COALESCE(SUM(valor), 0) as total FROM saques WHERE status = 'pendente'`,
      sql`
        SELECT a.codigo, u.nome, COUNT(c.id) as conversoes, COALESCE(SUM(c.valor), 0) as total_ganho
        FROM afiliados a
        JOIN usuarios u ON u.id = a.usuario_id
        LEFT JOIN comissoes c ON c.afiliado_id = a.id
        GROUP BY a.id, a.codigo, u.nome
        ORDER BY conversoes DESC
        LIMIT 10
      `,
    ]);

    return NextResponse.json({
      dados: {
        total_afiliados: parseInt(totalAfiliados[0].count),
        comissoes: totalComissoes,
        saques_pendentes_valor: parseFloat(saquesPendentes[0].total),
        top_afiliados: topAfiliados,
      },
    });
  } catch (err) {
    console.error("admin/afiliados/stats error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
