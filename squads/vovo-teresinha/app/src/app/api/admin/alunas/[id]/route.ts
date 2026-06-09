import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS alunas_leandro (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nome TEXT,
      ativo BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_access_at TIMESTAMPTZ
    )
  `;
  await sql`ALTER TABLE alunas_leandro ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMPTZ`;
}

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const { nome, ativo } = await req.json();

    await ensureTable();
    const alunaRows = await sql`SELECT email FROM alunas_leandro WHERE id = ${parseInt(id)} LIMIT 1`;
    if (alunaRows.length === 0) return NextResponse.json({ erro: "Aluna não encontrada" }, { status: 404 });

    await sql`
      UPDATE alunas_leandro
      SET nome = COALESCE(${nome || null}, nome),
          ativo = COALESCE(${ativo !== undefined ? ativo : null}, ativo)
      WHERE id = ${parseInt(id)}
    `;

    if (ativo === false) {
      await sql`
        UPDATE usuarios SET tipo_usuario = 'free'
        WHERE email = ${alunaRows[0].email} AND tipo_usuario = 'aluna_leandro'
      `;
    } else if (ativo === true) {
      await sql`
        UPDATE usuarios SET tipo_usuario = 'aluna_leandro'
        WHERE email = ${alunaRows[0].email}
      `;
    }

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/alunas PUT error", err);
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

    await ensureTable();
    const alunaRows = await sql`SELECT email FROM alunas_leandro WHERE id = ${parseInt(id)} LIMIT 1`;
    if (alunaRows.length === 0) return NextResponse.json({ erro: "Aluna não encontrada" }, { status: 404 });

    await sql`UPDATE usuarios SET tipo_usuario = 'free' WHERE email = ${alunaRows[0].email} AND tipo_usuario = 'aluna_leandro'`;
    await sql`DELETE FROM alunas_leandro WHERE id = ${parseInt(id)}`;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/alunas DELETE error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
