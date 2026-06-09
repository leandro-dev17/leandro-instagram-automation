import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const rows = await sql`
      SELECT id, ingrediente, created_at
      FROM geladeira_ingredientes
      WHERE usuario_id = ${session.id}
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("geladeira GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { ingrediente } = await req.json();
    if (!ingrediente) return NextResponse.json({ erro: "Ingrediente obrigatório" }, { status: 400 });

    const result = await sql`
      INSERT INTO geladeira_ingredientes (usuario_id, ingrediente)
      VALUES (${session.id}, ${ingrediente.trim()})
      RETURNING id, ingrediente, created_at
    `;

    return NextResponse.json({ dados: result[0] }, { status: 201 });
  } catch (err) {
    console.error("geladeira POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { id } = await req.json();

    if (id) {
      await sql`DELETE FROM geladeira_ingredientes WHERE id = ${id} AND usuario_id = ${session.id}`;
    } else {
      await sql`DELETE FROM geladeira_ingredientes WHERE usuario_id = ${session.id}`;
    }

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("geladeira DELETE error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
