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
      SELECT s.id, s.valor, s.status, s.pix_destino, s.created_at,
             a.codigo, u.nome, u.email
      FROM saques s
      JOIN afiliados a ON a.id = s.afiliado_id
      JOIN usuarios u ON u.id = a.usuario_id
      ORDER BY s.created_at DESC
      LIMIT 100
    `;

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("admin/afiliados/saques error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
