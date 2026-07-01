import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium } from "@/lib/auth";

async function checarPremium(usuarioId: number): Promise<boolean> {
  const rows = await sql`SELECT tipo_usuario, trial_fim, plano FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
  if (rows.length === 0) return false;
  return isPremium(rows[0].tipo_usuario, rows[0].trial_fim, rows[0].plano);
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    if (!(await checarPremium(session.id))) {
      return NextResponse.json(
        { erro: "Lista de compras é exclusiva do plano Livro de Receitas", premium: false },
        { status: 403 }
      );
    }

    const rows = await sql`
      SELECT id, item, checked, receita_id, receita_titulo, created_at
      FROM lista_compras
      WHERE usuario_id = ${session.id}
      ORDER BY checked ASC, receita_titulo ASC NULLS LAST, created_at DESC
    `;

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("lista-compras GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    if (!(await checarPremium(session.id))) {
      return NextResponse.json(
        { erro: "Lista de compras é exclusiva do plano Livro de Receitas", premium: false },
        { status: 403 }
      );
    }

    const body = await req.json();

    // Batch insert from recipe detail
    if (Array.isArray(body.itens)) {
      const receitaId = body.receita_id || null;
      const receitaTitulo = body.receita_titulo || null;
      const result = [];
      for (const item of body.itens) {
        if (!item) continue;
        const r = await sql`
          INSERT INTO lista_compras (usuario_id, item, checked, receita_id, receita_titulo)
          VALUES (${session.id}, ${item.trim()}, false, ${receitaId}, ${receitaTitulo})
          ON CONFLICT DO NOTHING
          RETURNING id, item, checked, receita_id, receita_titulo, created_at
        `;
        if (r.length > 0) result.push(r[0]);
      }
      return NextResponse.json({ dados: result }, { status: 201 });
    }

    const { item, checked, id } = body;

    // Toggle check
    if (id !== undefined && checked !== undefined) {
      const r = await sql`
        UPDATE lista_compras SET checked = ${checked}
        WHERE id = ${id} AND usuario_id = ${session.id}
        RETURNING id, item, checked, receita_id, receita_titulo, created_at
      `;
      return NextResponse.json({ dados: r[0] });
    }

    // Single item insert
    if (!item) return NextResponse.json({ erro: "Item obrigatório" }, { status: 400 });

    const result = await sql`
      INSERT INTO lista_compras (usuario_id, item, checked)
      VALUES (${session.id}, ${item.trim()}, false)
      RETURNING id, item, checked, receita_id, receita_titulo, created_at
    `;

    return NextResponse.json({ dados: result[0] }, { status: 201 });
  } catch (err) {
    console.error("lista-compras POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    if (!(await checarPremium(session.id))) {
      return NextResponse.json(
        { erro: "Lista de compras é exclusiva do plano Livro de Receitas", premium: false },
        { status: 403 }
      );
    }

    const { id, receita_id } = await req.json();

    if (id) {
      await sql`DELETE FROM lista_compras WHERE id = ${id} AND usuario_id = ${session.id}`;
    } else if (receita_id) {
      await sql`DELETE FROM lista_compras WHERE receita_id = ${receita_id} AND usuario_id = ${session.id}`;
    } else {
      // Remove all checked items
      await sql`DELETE FROM lista_compras WHERE usuario_id = ${session.id} AND checked = true`;
    }

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("lista-compras DELETE error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
