import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { comparePassword, signToken, cookieOptions } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { email, senha } = await req.json();

    if (!email || !senha) {
      return NextResponse.json({ erro: "Email e senha são obrigatórios" }, { status: 400 });
    }

    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      req.headers.get("x-real-ip") ||
      "desconhecido";
    const emailNormalizado = email.toLowerCase().trim();

    const rows = await sql`
      SELECT id, nome, email, senha_hash, tipo_usuario, trial_fim
      FROM usuarios
      WHERE email = ${emailNormalizado}
      LIMIT 1
    `;

    if (rows.length === 0) {
      sql`INSERT INTO logs_login (email, ip, sucesso) VALUES (${emailNormalizado}, ${ip}, false)`.catch(() => {});
      return NextResponse.json({ erro: "Email ou senha incorretos" }, { status: 401 });
    }

    const user = rows[0];
    const valid = await comparePassword(senha, user.senha_hash);

    if (!valid) {
      sql`INSERT INTO logs_login (email, ip, sucesso) VALUES (${emailNormalizado}, ${ip}, false)`.catch(() => {});
      return NextResponse.json({ erro: "Email ou senha incorretos" }, { status: 401 });
    }

    sql`INSERT INTO logs_login (email, ip, sucesso) VALUES (${emailNormalizado}, ${ip}, true)`.catch(() => {});

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
