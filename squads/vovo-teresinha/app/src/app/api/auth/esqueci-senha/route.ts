import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import jwt from "jsonwebtoken";
import { enviarEmailRedefinirSenha } from "@/lib/brevo";

export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email) {
      return NextResponse.json({ erro: "Email é obrigatório" }, { status: 400 });
    }

    const rows = await sql`
      SELECT id, nome, email FROM usuarios WHERE email = ${email.toLowerCase().trim()} LIMIT 1
    `;

    // Retorna ok mesmo se não achar (segurança contra enumeração)
    if (rows.length === 0) {
      return NextResponse.json({ dados: { ok: true } });
    }

    const user = rows[0];
    const token = jwt.sign(
      { id: user.id, email: user.email, type: "reset" },
      process.env.JWT_SECRET!,
      { expiresIn: "1h" }
    );

    await enviarEmailRedefinirSenha(user.email, user.nome, token).catch(() => {});

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("esqueci-senha error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
