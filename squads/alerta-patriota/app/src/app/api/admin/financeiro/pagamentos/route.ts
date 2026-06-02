/**
 * GET /api/admin/financeiro/pagamentos
 * Retorna os últimos N pagamentos com dados do usuário (join).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const limite = Math.min(parseInt(searchParams.get("limite") || "30"), 100);

    const pagamentos = await sql`
      SELECT
        p.id,
        p.usuario_id,
        u.nome AS nome_usuario,
        u.email AS email_usuario,
        u.plano,
        p.valor,
        p.metodo,
        p.status,
        p.mp_payment_id,
        p.created_at
      FROM pagamentos p
      LEFT JOIN usuarios u ON u.id = p.usuario_id
      ORDER BY p.created_at DESC
      LIMIT ${limite}
    `;

    return NextResponse.json({ pagamentos });
  } catch (err) {
    if (String(err).includes("Acesso negado")) {
      return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    }
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
