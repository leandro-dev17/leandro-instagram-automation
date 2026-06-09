import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { comparePassword, signToken, cookieOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, senha } = await req.json();

    if (!email || !senha) {
      return NextResponse.json({ erro: "Email e senha são obrigatórios" }, { status: 400 });
    }

    const rows = await sql`
      SELECT id, nome, email, senha_hash, tipo_usuario, trial_fim
      FROM usuarios
      WHERE email = ${email.toLowerCase().trim()}
      LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ erro: "Email ou senha incorretos" }, { status: 401 });
    }

    const user = rows[0];
    const valid = await comparePassword(senha, user.senha_hash);

    if (!valid) {
      return NextResponse.json({ erro: "Email ou senha incorretos" }, { status: 401 });
    }

    const token = signToken({
      id: user.id,
      email: user.email,
      tipo_usuario: user.tipo_usuario,
      nome: user.nome,
    });

    if (user.tipo_usuario === "aluna_leandro") {
      sql`UPDATE alunas_leandro SET last_access_at = NOW() WHERE email = ${user.email}`.catch(() => {});
    }

    const res = NextResponse.json({ dados: { nome: user.nome, tipo_usuario: user.tipo_usuario } });
    res.cookies.set({ ...cookieOptions(), value: token });
    return res;
  } catch (err) {
    console.error("login error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
