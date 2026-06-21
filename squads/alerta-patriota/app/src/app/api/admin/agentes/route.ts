import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// GET — status e últimas execuções de todos os agentes
export async function GET() {
  try {
    await requireAdmin();

    const logs = await sql`
      SELECT agente,
        MAX(created_at) as ultima_execucao,
        COUNT(*) FILTER (WHERE status = 'sucesso' AND created_at >= NOW() - INTERVAL '24 hours') as sucesso_24h,
        COUNT(*) FILTER (WHERE status = 'erro' AND created_at >= NOW() - INTERVAL '24 hours') as erro_24h,
        (SELECT status FROM agentes_log a2 WHERE a2.agente = a.agente ORDER BY created_at DESC LIMIT 1) as ultimo_status
      FROM agentes_log a
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY agente
      ORDER BY ultima_execucao DESC
    `;

    const alertasAbertos = await sql`
      SELECT * FROM alertas WHERE resolvido = false ORDER BY created_at DESC LIMIT 20
    `;

    return NextResponse.json({ agentes: logs, alertas: alertasAbertos });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

// POST — executa agente manualmente
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { rota } = await req.json();
    if (!rota?.startsWith("/api/cron/")) return NextResponse.json({ erro: "Rota inválida" }, { status: 400 });

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
    const CRON_SECRET = process.env.CRON_SECRET || "";

    const res = await fetch(`${APP_URL}${rota}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    return NextResponse.json({ ok: res.ok, status: res.status, resultado: data });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
