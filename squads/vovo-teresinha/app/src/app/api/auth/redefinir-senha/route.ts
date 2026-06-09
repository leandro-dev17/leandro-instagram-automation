import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import jwt from "jsonwebtoken";

export async function POST(req: NextRequest) {
  try {
    const { token, nova_senha } = await req.json();

    if (!token || !nova_senha) {
      return NextResponse.json({ erro: "Token e nova senha são obrigatórios" }, { status: 400 });
    }

    if (nova_senha.length < 8) {
      return NextResponse.json({ erro: "Senha deve ter ao menos 8 caracteres" }, { status: 400 });
    }

    let payload: { id: number; email: string; type: string };
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!) as typeof payload;
    } catch {
      return NextResponse.json({ erro: "Token inválido ou expirado" }, { status: 400 });
    }

    if (payload.type !== "reset") {
      return NextResponse.json({ erro: "Token inválido" }, { status: 400 });
    }

    const senha_hash = await hashPassword(nova_senha);

    await sql`
      UPDATE usuarios SET senha_hash = ${senha_hash} WHERE id = ${payload.id}
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("redefinir-senha error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
