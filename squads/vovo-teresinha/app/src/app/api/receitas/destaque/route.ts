import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();

    const cfgRows = await sql`SELECT valor FROM app_configuracoes WHERE chave = 'receita_do_dia_id'`;
    if (cfgRows.length === 0 || !cfgRows[0].valor) {
      return NextResponse.json({ dados: null });
    }

    const receitaId = parseInt(cfgRows[0].valor);
    if (isNaN(receitaId)) return NextResponse.json({ dados: null });

    const rows = await sql`
      SELECT id, titulo, descricao, categoria, foto_url, tempo_preparo, porcoes, is_premium, is_free_rotativa
      FROM receitas
      WHERE id = ${receitaId}
      LIMIT 1
    `;

    if (rows.length === 0) return NextResponse.json({ dados: null });

    const receita = rows[0];
    let trialFim: string | null = null;
    if (session) {
      const userRows = await sql`SELECT trial_fim FROM usuarios WHERE id = ${session.id} LIMIT 1`;
      trialFim = userRows[0]?.trial_fim ?? null;
    }
    const userIsPremium = session ? isPremium(session.tipo_usuario, trialFim) : false;
    const locked = receita.is_premium && !userIsPremium && !receita.is_free_rotativa;

    return NextResponse.json({ dados: { ...receita, locked } });
  } catch (err) {
    console.error("receitas/destaque GET error", err);
    return NextResponse.json({ dados: null });
  }
}
