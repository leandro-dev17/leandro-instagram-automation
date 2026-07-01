import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { id } = await params;

    await sql`
      UPDATE usuarios
      SET tipo_usuario = 'free', plano = null, assinatura_id = null
      WHERE id = ${parseInt(id)}
    `;

    await sql`
      UPDATE assinaturas SET status = 'cancelado', cancelado_em = NOW()
      WHERE usuario_id = ${parseInt(id)} AND status = 'ativo'
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/usuarios/cancelar error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
