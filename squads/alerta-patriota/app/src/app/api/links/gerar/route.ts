import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getUsuarioLogado } from "@/lib/auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

export async function POST(req: NextRequest) {
  try {
    const usuario = await getUsuarioLogado();
    if (!usuario) {
      return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    }

    const body = await req.json() as { noticia_id: string };
    const { noticia_id } = body;

    if (!noticia_id) {
      return NextResponse.json({ erro: "noticia_id obrigatório" }, { status: 400 });
    }

    const noticias = await sql`SELECT id FROM noticias WHERE id = ${noticia_id} LIMIT 1`;
    if (noticias.length === 0) {
      return NextResponse.json({ erro: "Notícia não encontrada" }, { status: 404 });
    }

    const token = crypto.randomUUID().replace(/-/g, "").substring(0, 16);

    await sql`
      INSERT INTO links_compartilhamento (usuario_id, noticia_id, token)
      VALUES (${usuario.id}, ${noticia_id}, ${token})
    `;

    return NextResponse.json({
      ok: true,
      url: `${APP_URL}/n/${token}`,
      token,
    });
  } catch (err) {
    console.error("links/gerar error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
