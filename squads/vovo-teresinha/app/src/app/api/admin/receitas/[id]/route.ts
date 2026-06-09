import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const body = await req.json();
    const {
      titulo, descricao, categoria, tags_restricao, ingredientes, modo_preparo,
      tempo_preparo, calorias, porcoes, foto_url, is_premium, is_free_rotativa, is_personal,
      dica_vovo, proteina, carboidratos, gordura, fibras,
    } = body;

    await sql`
      UPDATE receitas SET
        titulo = COALESCE(${titulo || null}, titulo),
        descricao = COALESCE(${descricao || null}, descricao),
        categoria = COALESCE(${categoria || null}, categoria),
        tags_restricao = COALESCE(${tags_restricao || null}, tags_restricao),
        ingredientes = COALESCE(${ingredientes || null}, ingredientes),
        modo_preparo = COALESCE(${modo_preparo || null}, modo_preparo),
        tempo_preparo = COALESCE(${tempo_preparo || null}, tempo_preparo),
        calorias = COALESCE(${calorias || null}, calorias),
        porcoes = COALESCE(${porcoes || null}, porcoes),
        foto_url = COALESCE(${foto_url || null}, foto_url),
        is_premium = COALESCE(${is_premium !== undefined ? is_premium : null}, is_premium),
        is_free_rotativa = COALESCE(${is_free_rotativa !== undefined ? is_free_rotativa : null}, is_free_rotativa),
        is_personal = COALESCE(${is_personal !== undefined ? is_personal : null}, is_personal),
        dica_vovo = COALESCE(${dica_vovo || null}, dica_vovo),
        proteina = COALESCE(${proteina || null}, proteina),
        carboidratos = COALESCE(${carboidratos || null}, carboidratos),
        gordura = COALESCE(${gordura || null}, gordura),
        fibras = COALESCE(${fibras || null}, fibras)
      WHERE id = ${parseInt(id)}
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/receitas PUT error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { id } = await params;

    await sql`DELETE FROM favoritos WHERE receita_id = ${parseInt(id)}`;
    await sql`DELETE FROM avaliacoes_receitas WHERE receita_id = ${parseInt(id)}`;
    await sql`DELETE FROM receitas WHERE id = ${parseInt(id)}`;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/receitas DELETE error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
