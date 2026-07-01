import { NextRequest, NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA;

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

    if (!EVO_URL || !EVO_KEY || !EVO_INST) {
      return NextResponse.json({ erro: "Evolution API não configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY/EVOLUTION_INSTANCIA vazias)" }, { status: 500 });
    }

    const numero = telefone.replace(/\D/g, "");

    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": EVO_KEY,
      },
      body: JSON.stringify({
        number: numero,
        text: mensagem,
      }),
    });

    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      return NextResponse.json({ erro: data?.message || "Falha ao enviar" }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("whatsapp/enviar error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
