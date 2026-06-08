import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql } from "@/lib/db";
import { gerarToken, setCookieToken } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { nome, email, senha, telefone } = await req.json();

    if (!nome || !email || !senha) {
      return NextResponse.json({ erro: "Nome, e-mail e senha são obrigatórios" }, { status: 400 });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ erro: "E-mail inválido" }, { status: 400 });
    }
    if (senha.length < 6) {
      return NextResponse.json({ erro: "Senha deve ter no mínimo 6 caracteres" }, { status: 400 });
    }

    const existe = await sql`SELECT id FROM usuarios WHERE email = ${email} LIMIT 1`;
    if (existe.length > 0) {
      return NextResponse.json({ erro: "E-mail já cadastrado" }, { status: 409 });
    }

    const senha_hash = await bcrypt.hash(senha, 10);
    const trialFim = new Date();
    trialFim.setDate(trialFim.getDate() + 7);

    const rows = await sql`
      INSERT INTO usuarios (nome, email, senha_hash, telefone, status, trial_inicio, trial_fim)
      VALUES (${nome}, ${email.toLowerCase()}, ${senha_hash}, ${telefone || null}, 'trial', NOW(), ${trialFim.toISOString()})
      RETURNING id, nome, email, tipo_usuario, status, plano
    `;

    const usuario = rows[0];
    const token = gerarToken({ id: usuario.id, email: usuario.email, tipo: usuario.tipo_usuario });

    return NextResponse.json({ ok: true, usuario }, { headers: setCookieToken(token) });
  } catch (err) {
    console.error("cadastro error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
