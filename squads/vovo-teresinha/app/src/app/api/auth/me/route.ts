import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";

async function queryWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isNeonError = err && typeof err === "object" && "constructor" in err && (err as { constructor: { name: string } }).constructor.name === "NeonDbError";
      if (i < retries && isNeonError) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export async function GET() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    }

    const rows = await queryWithRetry(() => sql`
      SELECT u.id, u.nome, u.email, u.whatsapp, u.aceita_whatsapp, u.tipo_usuario, u.plano,
             u.trial_inicio, u.trial_fim, u.assinatura_id, u.created_at,
             al.sexo
      FROM usuarios u
      LEFT JOIN alunas_leandro al ON al.email = u.email AND u.tipo_usuario = 'aluna_leandro'
      WHERE u.id = ${session.id}
      LIMIT 1
    `);

    if (rows.length === 0) {
      return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });
    }

    return NextResponse.json({ dados: rows[0] });
  } catch (err) {
    console.error("me error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
