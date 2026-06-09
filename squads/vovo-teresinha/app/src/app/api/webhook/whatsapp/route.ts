import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const event = body.event;
    const data = body.data;

    if (event === "messages.upsert" && data?.message) {
      const from = data.key?.remoteJid?.replace("@s.whatsapp.net", "");
      if (!from) return NextResponse.json({ ok: true });

      const texto = data.message?.conversation || data.message?.extendedTextMessage?.text || "";

      if (texto) {
        await sql`
          INSERT INTO historico_busca (usuario_id, query)
          SELECT id, ${`[WhatsApp] ${texto}`}
          FROM usuarios WHERE whatsapp = ${from}
          LIMIT 1
        `;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("webhook/whatsapp error", err);
    return NextResponse.json({ ok: true });
  }
}
