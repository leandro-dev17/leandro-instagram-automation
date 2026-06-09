import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const rows = await sql`
      SELECT id FROM push_subscriptions WHERE usuario_id = ${session.id} LIMIT 1
    `;

    return NextResponse.json({ ativo: rows.length > 0 });
  } catch (err) {
    console.error("push/subscribe GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { endpoint, keys } = await req.json();

    if (!endpoint || !keys?.p256dh || !keys?.auth) {
      return NextResponse.json({ erro: "Dados de subscription inválidos" }, { status: 400 });
    }

    await sql`
      INSERT INTO push_subscriptions (usuario_id, endpoint, p256dh, auth)
      VALUES (${session.id}, ${endpoint}, ${keys.p256dh}, ${keys.auth})
      ON CONFLICT (endpoint) DO UPDATE SET p256dh = ${keys.p256dh}, auth = ${keys.auth}
    `;

    return NextResponse.json({ dados: { ok: true } }, { status: 201 });
  } catch (err) {
    console.error("push/subscribe POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    await sql`
      DELETE FROM push_subscriptions WHERE usuario_id = ${session.id}
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("push/subscribe DELETE error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
