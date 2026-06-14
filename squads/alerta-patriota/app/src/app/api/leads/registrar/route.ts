import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

async function ensureLeadsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      nome VARCHAR(255),
      plano_interesse VARCHAR(20),
      origem VARCHAR(50),
      convertido BOOLEAN DEFAULT false,
      ultimo_email_enviado INT DEFAULT 0,
      email_enviado_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `.catch(() => null);
}

export async function POST(req: NextRequest) {
  try {
    await ensureLeadsTable();

    const body = await req.json() as {
      email: string;
      nome?: string;
      plano?: string;
      origem?: string;
    };

    const { email, nome, plano, origem } = body;

    if (!email?.trim()) {
      return NextResponse.json({ erro: "E-mail obrigatório" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ erro: "E-mail inválido" }, { status: 400 });
    }

    const planoValido = plano && ["vip", "elite"].includes(plano) ? plano : null;
    const origemValida = origem || "landing";

    await sql`
      INSERT INTO leads (email, nome, plano_interesse, origem)
      VALUES (
        ${email.toLowerCase().trim()},
        ${nome?.trim() || null},
        ${planoValido},
        ${origemValida}
      )
      ON CONFLICT (email) DO NOTHING
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("leads/registrar error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
