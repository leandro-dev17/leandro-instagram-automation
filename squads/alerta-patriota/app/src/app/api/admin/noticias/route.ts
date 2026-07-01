import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// GET — lista notícias com filtros
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const limite = Math.min(parseInt(searchParams.get("limite") || "20"), 200);
    const status = searchParams.get("status"); // pendente | publicada

    const noticias = await sql`
      SELECT id, titulo, fonte, url, categoria, urgente, global,
             postada_vip, postada_elite,
             resumo_braga, resumo_cavalcanti,
             resumo_braga IS NOT NULL as tem_resumo_braga,
             resumo_cavalcanti IS NOT NULL as tem_resumo_cavalcanti,
             created_at
      FROM noticias
      WHERE (
        ${status} IS NULL
        OR (${status} = 'pendente' AND (postada_vip = false OR postada_elite = false))
        OR (${status} = 'publicada' AND postada_vip = true AND postada_elite = true)
      )
      ORDER BY urgente DESC, created_at DESC
      LIMIT ${limite}
    `;

    return NextResponse.json({ noticias });
  } catch (err) {
    if (String(err).includes("Acesso negado")) {
      return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    }
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

// PATCH — edita resumo de uma notícia manualmente
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { id, resumo_braga, resumo_cavalcanti, urgente } = await req.json();

    await sql`
      UPDATE noticias
      SET
        resumo_braga = COALESCE(${resumo_braga ?? null}, resumo_braga),
        resumo_cavalcanti = COALESCE(${resumo_cavalcanti ?? null}, resumo_cavalcanti),
        urgente = COALESCE(${urgente ?? null}, urgente)
      WHERE id = ${id}
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).includes("Acesso negado")) {
      return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    }
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
