import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN!;

export async function POST() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const rows = await sql`
      SELECT mp_preapproval_id FROM assinaturas
      WHERE usuario_id = ${session.id} AND status = 'ativo'
      ORDER BY created_at DESC LIMIT 1
    `;

    if (rows.length === 0 || !rows[0].mp_preapproval_id) {
      return NextResponse.json({ erro: "Nenhuma assinatura ativa encontrada" }, { status: 404 });
    }

    const preapprovalId = rows[0].mp_preapproval_id;

    const res = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_TOKEN}`,
      },
      body: JSON.stringify({ status: "paused" }),
    });

    if (!res.ok) {
      const err = await res.json();
      console.error("MP pausar error", err);
      return NextResponse.json({ erro: "Não foi possível pausar a assinatura" }, { status: 500 });
    }

    await sql`
      UPDATE assinaturas SET status = 'paused', cancelado_em = NOW()
      WHERE usuario_id = ${session.id} AND mp_preapproval_id = ${preapprovalId}
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("assinaturas/pausar error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function DELETE() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const rows = await sql`
      SELECT mp_preapproval_id FROM assinaturas
      WHERE usuario_id = ${session.id} AND status IN ('ativo', 'paused')
      ORDER BY created_at DESC LIMIT 1
    `;

    if (rows.length === 0 || !rows[0].mp_preapproval_id) {
      return NextResponse.json({ erro: "Nenhuma assinatura encontrada" }, { status: 404 });
    }

    const preapprovalId = rows[0].mp_preapproval_id;

    const res = await fetch(`https://api.mercadopago.com/preapproval/${preapprovalId}`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${MP_TOKEN}`,
      },
      body: JSON.stringify({ status: "cancelled" }),
    });

    if (!res.ok) {
      return NextResponse.json({ erro: "Não foi possível cancelar a assinatura" }, { status: 500 });
    }

    await sql`
      UPDATE assinaturas SET status = 'cancelado', cancelado_em = NOW()
      WHERE usuario_id = ${session.id} AND mp_preapproval_id = ${preapprovalId}
    `;

    await sql`
      UPDATE usuarios SET tipo_usuario = 'free'
      WHERE id = ${session.id}
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("assinaturas/cancelar error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
