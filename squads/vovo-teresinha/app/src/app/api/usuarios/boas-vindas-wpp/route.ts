import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { enfileirarMensagem } from "@/lib/whatsapp";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ ok: true }); // silencioso

    // whatsapp_fila não tem UNIQUE(usuario_id, tipo) — "boas_vindas_app" é
    // uma mensagem única e a página /bem-vinda chama essa rota a cada
    // montagem, então sem essa checagem cada revisita reenfileira duplicata.
    const jaEnfileirado = await sql`
      SELECT 1 FROM whatsapp_fila WHERE usuario_id = ${session.id} AND tipo = 'boas_vindas_app' LIMIT 1
    `;
    if (jaEnfileirado.length === 0) {
      enfileirarMensagem(session.id, "boas_vindas_app").catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
