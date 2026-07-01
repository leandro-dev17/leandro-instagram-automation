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

    let payload: { id: number; email: string; type: string; iat: number };
    try {
      payload = jwt.verify(token, process.env.JWT_SECRET!) as typeof payload;
    } catch {
      return NextResponse.json({ erro: "Token inválido ou expirado" }, { status: 400 });
    }

    if (payload.type !== "reset") {
      return NextResponse.json({ erro: "Token inválido" }, { status: 400 });
    }

    // Rejeita o token se já foi usado (ou se a senha já foi alterada por outro
    // meio) desde que ele foi emitido — torna o link de redefinição single-use.
    const userRows = await sql`SELECT senha_alterada_em FROM usuarios WHERE id = ${payload.id} LIMIT 1`;
    if (userRows.length === 0) {
      return NextResponse.json({ erro: "Token inválido" }, { status: 400 });
    }
    const senhaAlteradaEm = userRows[0].senha_alterada_em as string | null;
    if (senhaAlteradaEm && new Date(senhaAlteradaEm).getTime() > payload.iat * 1000) {
      return NextResponse.json({ erro: "Este link já foi usado. Solicite um novo." }, { status: 400 });
    }

    const senha_hash = await hashPassword(nova_senha);

    await sql`
      UPDATE usuarios SET senha_hash = ${senha_hash}, senha_alterada_em = NOW() WHERE id = ${payload.id}
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("redefinir-senha error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
