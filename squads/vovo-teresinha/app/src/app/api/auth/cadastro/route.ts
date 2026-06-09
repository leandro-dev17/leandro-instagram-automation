import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword, signToken, cookieOptions } from "@/lib/auth";
import { enviarEmailBoasVindas } from "@/lib/brevo";

export async function POST(req: NextRequest) {
  try {
    const { nome, email, senha, whatsapp, aceita_whatsapp } = await req.json();

    if (!nome || !email || !senha) {
      return NextResponse.json({ erro: "Nome, email e senha são obrigatórios" }, { status: 400 });
    }

    if (senha.length < 8) {
      return NextResponse.json({ erro: "Senha deve ter ao menos 8 caracteres" }, { status: 400 });
    }

    const existing = await sql`
      SELECT id FROM usuarios WHERE email = ${email.toLowerCase().trim()} LIMIT 1
    `;

    if (existing.length > 0) {
      return NextResponse.json({ erro: "Este email já está cadastrado" }, { status: 409 });
    }

    const senha_hash = await hashPassword(senha);
    const emailNorm = email.toLowerCase().trim();

    const result = await sql`
      INSERT INTO usuarios (nome, email, senha_hash, whatsapp, aceita_whatsapp, tipo_usuario)
      VALUES (${nome.trim()}, ${emailNorm}, ${senha_hash}, ${whatsapp || null}, ${aceita_whatsapp || false}, 'free')
      RETURNING id, nome, email, tipo_usuario
    `;

    const user = result[0];

    const token = signToken({
      id: user.id,
      email: user.email,
      tipo_usuario: user.tipo_usuario,
      nome: user.nome,
    });

    // Enviar boas-vindas sem bloquear a resposta
    enviarEmailBoasVindas(user.email, user.nome).catch(() => {});

    const res = NextResponse.json({ dados: { nome: user.nome, tipo_usuario: user.tipo_usuario } }, { status: 201 });
    res.cookies.set({ ...cookieOptions(), value: token });
    return res;
  } catch (err) {
    console.error("cadastro error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
