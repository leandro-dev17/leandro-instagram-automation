import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET() {
  try {
    await requireAdmin();
    const grupos = await sql`
      SELECT g.*,
        COUNT(mg.id) FILTER (WHERE mg.status = 'ativo') as membros_reais
      FROM grupos_whatsapp g
      LEFT JOIN membros_grupos mg ON mg.grupo_id = g.id
      GROUP BY g.id
      ORDER BY g.plano
    `;
    return NextResponse.json({ grupos });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { id, link_convite, group_id_wa, max_membros } = await req.json();
    await sql`
      UPDATE grupos_whatsapp
      SET link_convite = COALESCE(${link_convite ?? null}, link_convite),
          group_id_wa  = COALESCE(${group_id_wa ?? null}, group_id_wa),
          max_membros  = COALESCE(${max_membros ?? null}, max_membros)
      WHERE id = ${id}
    `;
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
