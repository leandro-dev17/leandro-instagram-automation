import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, comparePassword, hashPassword } from "@/lib/auth";

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { senha_atual, nova_senha } = await req.json();

    if (!senha_atual || !nova_senha) {
      return NextResponse.json({ erro: "Senha atual e nova senha são obrigatórias" }, { status: 400 });
    }

    if (nova_senha.length < 8) {
      return NextResponse.json({ erro: "Nova senha deve ter ao menos 8 caracteres" }, { status: 400 });
    }

    const rows = await sql`SELECT senha_hash FROM usuarios WHERE id = ${session.id} LIMIT 1`;
    if (rows.length === 0) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

    const valid = await comparePassword(senha_atual, rows[0].senha_hash);
    if (!valid) return NextResponse.json({ erro: "Senha atual incorreta" }, { status: 400 });

    const hash = await hashPassword(nova_senha);
    await sql`UPDATE usuarios SET senha_hash = ${hash}, senha_alterada_em = NOW() WHERE id = ${session.id}`;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("senha PUT error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
