import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const rows = await sql`
      SELECT f.id, f.receita_id, f.criado_em AS created_at,
             r.titulo, r.descricao, r.categoria, r.foto_url,
             r.tempo_preparo, r.calorias, r.is_premium, r.is_free_rotativa, r.tags_restricao
      FROM favoritos f
      JOIN receitas r ON r.id = f.receita_id
      WHERE f.usuario_id = ${session.id}
      ORDER BY f.criado_em DESC NULLS LAST
    `;

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("favoritos GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { receita_id } = await req.json();
    if (!receita_id) return NextResponse.json({ erro: "receita_id obrigatório" }, { status: 400 });

    const existing = await sql`
      SELECT id FROM favoritos WHERE usuario_id = ${session.id} AND receita_id = ${receita_id} LIMIT 1
    `;

    if (existing.length > 0) {
      return NextResponse.json({ dados: { id: existing[0].id } });
    }

    // Free users can only save up to 5 favorites
    const userRows = await sql`
      SELECT tipo_usuario, trial_fim, plano FROM usuarios WHERE id = ${session.id} LIMIT 1
    `;
    const user = userRows[0];
    const userIsPremium = isPremium(user.tipo_usuario, user.trial_fim, user.plano);

    if (!userIsPremium) {
      const countRows = await sql`
        SELECT COUNT(*) AS total FROM favoritos WHERE usuario_id = ${session.id}
      `;
      if (parseInt(countRows[0].total) >= 5) {
        return NextResponse.json(
          { erro: "Limite de 5 favoritos para o plano gratuito. Assine o Premium para favoritar sem limite! 💕" },
          { status: 403 }
        );
      }
    }

    const result = await sql`
      INSERT INTO favoritos (usuario_id, receita_id) VALUES (${session.id}, ${receita_id})
      RETURNING id
    `;

    return NextResponse.json({ dados: { id: result[0].id } }, { status: 201 });
  } catch (err) {
    console.error("favoritos POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { receita_id } = await req.json();
    if (!receita_id) return NextResponse.json({ erro: "receita_id obrigatório" }, { status: 400 });

    await sql`
      DELETE FROM favoritos WHERE usuario_id = ${session.id} AND receita_id = ${receita_id}
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("favoritos DELETE error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
