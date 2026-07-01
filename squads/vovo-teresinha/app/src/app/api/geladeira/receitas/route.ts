import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium } from "@/lib/auth";

async function gerarComGroq(prompt: string): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: "llama-3.3-70b-versatile",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 1024,
      response_format: { type: "json_object" },
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const uRows = await sql`SELECT tipo_usuario, trial_fim, plano FROM usuarios WHERE id = ${session.id} LIMIT 1`;
    if (uRows.length === 0 || !isPremium(uRows[0].tipo_usuario, uRows[0].trial_fim, uRows[0].plano)) {
      return NextResponse.json(
        { erro: "Geladeira Inteligente é exclusiva do plano Livro de Receitas", premium: false },
        { status: 403 }
      );
    }

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

    const content = await gerarComGroq(`Tenho estes ingredientes na geladeira: ${lista}

Aqui estão receitas disponíveis (ID | Título | Ingredientes):
${receitasTexto}

Para cada receita que pode ser feita (totalmente ou em sua maioria) com os ingredientes disponíveis, retorne o ID e a porcentagem de ingredientes que o usuário já tem (0-100). Retorne em formato JSON: {"receitas": [{"id": 1, "porcentagem": 85}, {"id": 2, "porcentagem": 60}]}. Máximo 10 receitas, ordenadas por porcentagem decrescente. Só retorne o JSON, nada mais.`);

    let matches: Array<{ id: number; porcentagem: number }> = [];
    try {
      const parsed = JSON.parse(content);
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
