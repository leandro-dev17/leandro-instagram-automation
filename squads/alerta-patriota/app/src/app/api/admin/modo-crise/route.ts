import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

// Fase 30, categoria 5: `acao` ia direto do body pro query string do cron sem
// validação — mesmo o cron rejeitando ações desconhecidas com 400, este endpoint
// repassava qualquer valor recebido (inclusive não-string) sem checar contra a
// lista de ações que o painel realmente oferece.
export const maxDuration = 60;

const ACOES_VALIDAS = ["ativar", "desativar", "status", "verificar"];

export async function GET() {
  try {
    await requireAdmin();
    const ativo = await sql`SELECT id FROM alertas WHERE tipo = 'modo_crise' AND resolvido = false LIMIT 1`;
    return NextResponse.json({ ativo: ativo.length > 0 });
  } catch (err) {
    console.error("admin/modo-crise GET error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { acao } = await req.json();
    if (!ACOES_VALIDAS.includes(acao)) {
      return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });
    }

    const res = await fetch(`${APP_URL}/api/cron/modo-crise?acao=${acao}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(15000),
    });
    const data = await res.json();

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('admin-manual', ${`modo_crise_${acao}`}, 'sucesso', ${JSON.stringify({ adminId: admin.id, adminEmail: admin.email })})`;

    return NextResponse.json({ ok: true, ...data });
  } catch (err) {
    console.error("admin/modo-crise POST error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
