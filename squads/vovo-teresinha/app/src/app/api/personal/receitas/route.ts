import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const uRows = await sql`SELECT tipo_usuario, trial_fim FROM usuarios WHERE id = ${session.id} LIMIT 1`;
    if (uRows.length === 0) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

    const user = uRows[0];
    const premium = isPremium(user.tipo_usuario, user.trial_fim);

    if (!premium) {
      return NextResponse.json({ erro: "Acesso exclusivo para membros premium", premium: false }, { status: 403 });
    }

    const rows = await sql`
      SELECT id, titulo, descricao, categoria, refeicao, tags_restricao, tempo_preparo, calorias,
             porcoes, foto_url, is_premium, created_at
      FROM receitas
      WHERE is_personal = true
      ORDER BY created_at DESC
    `;

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("personal/receitas GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
