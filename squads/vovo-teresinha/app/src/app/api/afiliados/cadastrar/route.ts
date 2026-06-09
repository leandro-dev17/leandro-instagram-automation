import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

function gerarCodigo(nome: string): string {
  const base = nome.toLowerCase().replace(/[^a-z]/g, "").slice(0, 8);
  const sufixo = Math.random().toString(36).slice(2, 6);
  return `${base}${sufixo}`;
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { cpf, pix_chave } = await req.json();

    if (!cpf || !pix_chave) {
      return NextResponse.json({ erro: "CPF e chave PIX são obrigatórios" }, { status: 400 });
    }

    const existing = await sql`
      SELECT id FROM afiliados WHERE usuario_id = ${session.id} LIMIT 1
    `;

    if (existing.length > 0) {
      return NextResponse.json({ erro: "Você já está cadastrado como afiliado" }, { status: 400 });
    }

    const uRows = await sql`SELECT nome, tipo_usuario FROM usuarios WHERE id = ${session.id} LIMIT 1`;
    if (uRows.length === 0) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

    if (uRows[0].tipo_usuario === "free") {
      return NextResponse.json({ erro: "Apenas usuários premium podem se tornar afiliados" }, { status: 403 });
    }

    const codigo = gerarCodigo(uRows[0].nome);

    const result = await sql`
      INSERT INTO afiliados (usuario_id, codigo, cpf, pix_chave, tier)
      VALUES (${session.id}, ${codigo}, ${cpf}, ${pix_chave}, 1)
      RETURNING id, codigo, tier
    `;

    return NextResponse.json({ dados: result[0] }, { status: 201 });
  } catch (err) {
    console.error("afiliados/cadastrar error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
