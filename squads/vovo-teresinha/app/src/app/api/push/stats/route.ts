import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const total = await sql`SELECT COUNT(*) as count FROM push_subscriptions`;
    const porDia = await sql`
      SELECT DATE(created_at) as dia, COUNT(*) as count
      FROM push_subscriptions
      WHERE created_at >= NOW() - INTERVAL '30 days'
      GROUP BY dia ORDER BY dia DESC
    `;

    return NextResponse.json({
      dados: {
        total_subscriptions: parseInt(total[0].count),
        por_dia: porDia,
      },
    });
  } catch (err) {
    console.error("push/stats error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
