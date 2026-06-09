import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const busca = searchParams.get("busca");
    const categoria = searchParams.get("categoria");
    const personal = searchParams.get("personal") === "1";
    const pagina = parseInt(searchParams.get("pagina") || "1");
    const limite = 30;
    const offset = (pagina - 1) * limite;

    let rows;

    if (personal) {
      rows = await sql`
        SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
               foto_url, is_premium, is_free_rotativa, is_personal, created_at
        FROM receitas
        WHERE is_personal = true
        ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else if (busca) {
      rows = await sql`
        SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
               foto_url, is_premium, is_free_rotativa, is_personal, created_at
        FROM receitas
        WHERE titulo ILIKE ${'%' + busca + '%'}
        ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else if (categoria) {
      rows = await sql`
        SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
               foto_url, is_premium, is_free_rotativa, is_personal, created_at
        FROM receitas WHERE categoria = ${categoria}
        ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
               foto_url, is_premium, is_free_rotativa, is_personal, created_at
        FROM receitas
        ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}
      `;
    }

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("admin/receitas GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const body = await req.json();
    const {
      titulo, descricao, categoria, tags_restricao, ingredientes, modo_preparo,
      tempo_preparo, calorias, porcoes, foto_url, is_premium, is_free_rotativa, is_personal,
      dica_vovo, proteina, carboidratos, gordura, fibras,
    } = body;

    if (!titulo || !descricao || !categoria || !ingredientes || !modo_preparo) {
      return NextResponse.json({ erro: "Campos obrigatórios: titulo, descricao, categoria, ingredientes, modo_preparo" }, { status: 400 });
    }

    const result = await sql`
      INSERT INTO receitas (
        titulo, descricao, categoria, tags_restricao, ingredientes, modo_preparo,
        tempo_preparo, calorias, porcoes, foto_url, is_premium, is_free_rotativa, is_personal,
        dica_vovo, proteina, carboidratos, gordura, fibras
      )
      VALUES (
        ${titulo}, ${descricao}, ${categoria}, ${tags_restricao || []}, ${ingredientes},
        ${modo_preparo}, ${tempo_preparo || 30}, ${calorias || null}, ${porcoes || 4},
        ${foto_url || null}, ${is_premium ?? true}, ${is_free_rotativa ?? false},
        ${is_personal ?? false}, ${dica_vovo || null}, ${proteina || null},
        ${carboidratos || null}, ${gordura || null}, ${fibras || null}
      )
      RETURNING id, titulo
    `;

    return NextResponse.json({ dados: result[0] }, { status: 201 });
  } catch (err) {
    console.error("admin/receitas POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
