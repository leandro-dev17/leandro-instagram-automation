import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

const EVO_URL = process.env.EVOLUTION_API_URL!;
const EVO_KEY = process.env.EVOLUTION_API_KEY!;
const EVO_INST = process.env.EVOLUTION_INSTANCIA!;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { telefone, mensagem } = await req.json();
    if (!telefone || !mensagem) {
      return NextResponse.json({ erro: "Telefone e mensagem são obrigatórios" }, { status: 400 });
    }

    const numero = telefone.replace(/\D/g, "");

    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": EVO_KEY,
      },
      body: JSON.stringify({
        number: `${numero}@s.whatsapp.net`,
        textMessage: { text: mensagem },
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json({ erro: data?.message || "Falha ao enviar" }, { status: 500 });
    }

    // Registra na fila
    await sql`
      INSERT INTO whatsapp_queue (telefone, mensagem, status, enviado_em)
      VALUES (${numero}, ${mensagem}, 'enviado', NOW())
    `.catch(() => {});

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("whatsapp/enviar error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
