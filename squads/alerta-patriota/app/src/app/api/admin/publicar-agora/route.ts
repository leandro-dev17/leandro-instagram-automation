import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";

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

    for (const grupo of ["vip", "elite"]) {
      const res = await fetch(
        `${APP_URL}/api/cron/publicar-noticias?grupo=${grupo}${noticia_id ? `&noticia_id=${noticia_id}` : ""}`,
        { headers, signal: AbortSignal.timeout(15000) }
      );
      const data = await res.json().catch(() => ({}));
      resultados[grupo] = !!(data as { publicado?: boolean }).publicado;
    }

    return NextResponse.json({ ok: true, resultados });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
