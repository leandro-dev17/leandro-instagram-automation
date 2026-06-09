import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const { nome, email, tipo_usuario, plano, trial_fim } = await req.json();

    const TIPOS_VALIDOS = ["free", "premium", "aluna_leandro", "admin"];
    if (tipo_usuario && !TIPOS_VALIDOS.includes(tipo_usuario)) {
      return NextResponse.json({ erro: "Tipo inválido" }, { status: 400 });
    }

    await sql`
      UPDATE usuarios SET
        nome        = COALESCE(${nome        || null}, nome),
        email       = COALESCE(${email       || null}, email),
        tipo_usuario = COALESCE(${tipo_usuario || null}, tipo_usuario),
        plano       = COALESCE(${plano       ?? null}, plano),
        trial_fim   = COALESCE(${trial_fim   ?? null}, trial_fim)
      WHERE id = ${parseInt(id)}
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("admin/usuarios PUT error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const userId = parseInt(id);

    if (userId === session.id) {
      return NextResponse.json({ erro: "Não é possível excluir sua própria conta" }, { status: 400 });
    }

    await sql`DELETE FROM usuarios WHERE id = ${userId}`;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("admin/usuarios DELETE error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
