import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const rows = await sql`
      SELECT c.id, c.valor, c.status, c.criado_em, c.liberado_em,
             a.codigo, u.nome, u.email
      FROM comissoes c
      JOIN afiliados a ON a.id = c.afiliado_id
      JOIN usuarios u ON u.id = a.usuario_id
      ORDER BY c.criado_em DESC
      LIMIT 100
    `;

    const pendentes = await sql`
      SELECT COALESCE(SUM(c.valor), 0) as total FROM comissoes c
      WHERE c.status = 'pendente' AND c.liberado_em <= NOW()
    `;

    await sql`
      UPDATE comissoes SET status = 'liberado'
      WHERE status = 'pendente' AND liberado_em <= NOW()
    `;

    return NextResponse.json({
      dados: rows,
      liberados_agora: parseFloat(pendentes[0].total),
    });
  } catch (err) {
    console.error("admin/afiliados/comissoes error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
