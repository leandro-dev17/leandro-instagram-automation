import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { signToken } from "@/lib/auth";

const GUARDIAN_EMAIL = "guardiao@vovo.internal";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  // Criar usuário de teste se não existir
  const existing = await sql`
    SELECT id, nome, email, tipo_usuario FROM usuarios WHERE email = ${GUARDIAN_EMAIL} LIMIT 1
  `;

  let userId: number;
  if (existing.length === 0) {
    const inserted = await sql`
      INSERT INTO usuarios (nome, email, tipo_usuario)
      VALUES ('Guardião 24/7', ${GUARDIAN_EMAIL}, 'premium')
      RETURNING id
    `;
    userId = inserted[0].id;
  } else {
    userId = existing[0].id;
  }

  const token = signToken({
    id: userId,
    email: GUARDIAN_EMAIL,
    tipo_usuario: "premium",
    nome: "Guardião 24/7",
  });

  return NextResponse.json({ token, cookieName: process.env.COOKIE_NAME || "vovo-session" });
}
