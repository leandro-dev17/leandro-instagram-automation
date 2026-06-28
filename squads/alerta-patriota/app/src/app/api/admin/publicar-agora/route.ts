import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { sql } from "@/lib/db";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
  } catch {
    return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
  }

  try {
    const { noticia_id } = await req.json();

    const headers = { Authorization: `Bearer ${CRON_SECRET}` };
    const resultados: Record<string, boolean> = {};

    // Item 25 (Fase 30): antes acionava publicar-noticias para os 2 grupos sempre,
    // mesmo quando a notícia já estava publicada num deles. Como publicar-noticias
    // ignorava noticia_id (corrigido em paralelo), reacionar o grupo já publicado
    // disparava a publicação ANTECIPADA de outra notícia da fila nesse grupo, fora
    // do horário do cron — só porque faltava completar o grupo restante.
    let statusAtual: { postada_vip: boolean; postada_elite: boolean } | null = null;
    if (noticia_id) {
      const rows = await sql`SELECT postada_vip, postada_elite FROM noticias WHERE id = ${noticia_id} LIMIT 1`;
      if (rows.length > 0) statusAtual = rows[0] as { postada_vip: boolean; postada_elite: boolean };
    }

    for (const grupo of ["vip", "elite"] as const) {
      if (statusAtual && statusAtual[`postada_${grupo}`]) {
        resultados[grupo] = true;
        continue;
      }
      const res = await fetch(
        `${APP_URL}/api/cron/publicar-noticias?grupo=${grupo}${noticia_id ? `&noticia_id=${noticia_id}` : ""}`,
        { headers, signal: AbortSignal.timeout(15000) }
      );
      const data = await res.json().catch(() => ({}));
      resultados[grupo] = !!(data as { publicado?: boolean }).publicado;
    }

    return NextResponse.json({ ok: true, resultados });
  } catch (err) {
    console.error("admin/publicar-agora error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
