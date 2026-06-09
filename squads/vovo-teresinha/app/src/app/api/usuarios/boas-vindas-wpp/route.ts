import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { enfileirarMensagem } from "@/lib/whatsapp";

export async function POST() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ ok: true }); // silencioso

    enfileirarMensagem(session.id, "boas_vindas_app").catch(() => {});

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: true });
  }
}
