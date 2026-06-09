import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const minhaAvaliacao = await sql`
      SELECT nota FROM avaliacoes_receitas
      WHERE usuario_id = ${session.id} AND receita_id = ${parseInt(id)}
      LIMIT 1
    `;

    const media = await sql`
      SELECT AVG(nota)::NUMERIC(3,2) AS media, COUNT(*) AS total
      FROM avaliacoes_receitas WHERE receita_id = ${parseInt(id)}
    `;

    return NextResponse.json({
      minha_nota: minhaAvaliacao[0]?.nota ?? null,
      media: parseFloat(media[0]?.media) || 0,
      total: parseInt(media[0]?.total) || 0,
    });
  } catch (err) {
    console.error("avaliar GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { nota } = await req.json();
    if (!nota || nota < 1 || nota > 5) {
      return NextResponse.json({ erro: "Nota deve ser entre 1 e 5" }, { status: 400 });
    }

    await sql`
      INSERT INTO avaliacoes_receitas (usuario_id, receita_id, nota)
      VALUES (${session.id}, ${parseInt(id)}, ${nota})
      ON CONFLICT (usuario_id, receita_id) DO UPDATE SET nota = ${nota}
    `;

    // Update cached average on receitas table
    const media = await sql`
      SELECT AVG(nota)::NUMERIC(3,2) AS media, COUNT(*) AS total
      FROM avaliacoes_receitas WHERE receita_id = ${parseInt(id)}
    `;

    await sql`
      UPDATE receitas
      SET avaliacao_media = ${parseFloat(media[0].media)},
          avaliacao_count = ${parseInt(media[0].total)}
      WHERE id = ${parseInt(id)}
    `;

    return NextResponse.json({
      media: parseFloat(media[0].media),
      total: parseInt(media[0].total),
    });
  } catch (err) {
    console.error("avaliar POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
