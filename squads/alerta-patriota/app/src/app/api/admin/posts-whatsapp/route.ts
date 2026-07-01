import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// FASE 24: a aba "Histórico" de admin/conteudo chamava /api/admin/mensagens (plural),
// rota que nunca existiu — esta é a rota real que faltava, lendo a tabela posts_whatsapp
// já preenchida por admin/mensagem, webhook/whatsapp e os crons de publicação.
export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const limite = Math.min(parseInt(searchParams.get("limite") || "30"), 200);

    const posts = await sql`
      SELECT id, grupo_id, noticia_id, conteudo, tipo, status, enviado_at
      FROM posts_whatsapp ORDER BY enviado_at DESC LIMIT ${limite}
    `;

    return NextResponse.json({ posts });
  } catch (err) {
    console.error("admin/posts-whatsapp GET error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
