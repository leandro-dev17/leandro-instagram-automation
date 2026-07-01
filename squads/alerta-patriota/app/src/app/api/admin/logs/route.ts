import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();
    const { searchParams } = new URL(req.url);
    const agente = searchParams.get("agente");
    const status = searchParams.get("status");
    const limite = Math.min(parseInt(searchParams.get("limite") || "100"), 500);
    const offset = parseInt(searchParams.get("offset") || "0");

    const logs = await sql`
      SELECT id, agente, acao, status, detalhes, duracao_ms, created_at
      FROM agentes_log
      WHERE (${agente} IS NULL OR agente = ${agente})
        AND (${status} IS NULL OR status = ${status})
      ORDER BY created_at DESC
      LIMIT ${limite} OFFSET ${offset}
    `;

    const total = await sql`
      SELECT COUNT(*) as count FROM agentes_log
      WHERE (${agente} IS NULL OR agente = ${agente})
        AND (${status} IS NULL OR status = ${status})
    `;

    return NextResponse.json({ logs, total: Number(total[0].count) });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
