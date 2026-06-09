import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const ingredientes = await sql`
      SELECT ingrediente FROM geladeira_ingredientes WHERE usuario_id = ${session.id}
    `;

    if (ingredientes.length === 0) {
      return NextResponse.json({ dados: [], mensagem: "Adicione ingredientes à sua geladeira primeiro! 🥕" });
    }

    const lista = ingredientes.map((i: { ingrediente: string }) => i.ingrediente).join(", ");

    const receitas = await sql`
      SELECT id, titulo, descricao, categoria, tags_restricao, ingredientes, tempo_preparo, calorias,
             porcoes, foto_url, is_premium, is_free_rotativa, created_at
      FROM receitas
      WHERE is_personal = false
      ORDER BY created_at DESC
      LIMIT 100
    `;

    const receitasTexto = receitas.map((r: { id: number; titulo: string; ingredientes: string }) =>
      `ID:${r.id} | ${r.titulo} | Ingredientes: ${r.ingredientes}`
    ).join("\n");

    const response = await anthropic.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1024,
      messages: [
        {
          role: "user",
          content: `Tenho estes ingredientes na geladeira: ${lista}

Aqui estão receitas disponíveis (ID | Título | Ingredientes):
${receitasTexto}

Para cada receita que pode ser feita (totalmente ou em sua maioria) com os ingredientes disponíveis, retorne o ID e a porcentagem de ingredientes que o usuário já tem (0-100). Retorne em formato JSON: {"receitas": [{"id": 1, "porcentagem": 85}, {"id": 2, "porcentagem": 60}]}. Máximo 10 receitas, ordenadas por porcentagem decrescente. Só retorne o JSON, nada mais.`,
        },
      ],
    });

    const content = response.content[0];
    if (content.type !== "text") {
      return NextResponse.json({ dados: [], mensagem: "Não encontrei receitas para esses ingredientes 😅" });
    }

    let matches: Array<{ id: number; porcentagem: number }> = [];
    try {
      const parsed = JSON.parse(content.text.trim());
      matches = parsed.receitas || [];
    } catch {
      return NextResponse.json({ dados: [], mensagem: "Não encontrei receitas para esses ingredientes 😅" });
    }

    if (matches.length === 0) {
      return NextResponse.json({ dados: [], mensagem: "Não encontrei receitas para esses ingredientes 😅" });
    }

    const matchMap = new Map(matches.map((m) => [m.id, m.porcentagem]));
    const resultado = receitas
      .filter((r: { id: number }) => matchMap.has(r.id))
      .map((r: { id: number }) => ({ ...r, porcentagem_match: matchMap.get(r.id) ?? 0 }))
      .sort((a: { porcentagem_match: number }, b: { porcentagem_match: number }) => b.porcentagem_match - a.porcentagem_match);

    return NextResponse.json({ dados: resultado });
  } catch (err) {
    console.error("geladeira/receitas error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
