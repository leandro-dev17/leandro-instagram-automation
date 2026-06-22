import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const pagina = parseInt(searchParams.get("pagina") || "1");
    const limite = parseInt(searchParams.get("limite") || "50");
    const plano = searchParams.get("plano");
    const status = searchParams.get("status");
    const busca = searchParams.get("busca");
    const offset = (pagina - 1) * limite;

    const usuarios = await sql`
      SELECT id, nome, email, telefone, plano, status, tipo_usuario,
             trial_inicio, trial_fim, assinatura_inicio, created_at
      FROM usuarios
      WHERE
        (${plano} IS NULL OR plano = ${plano})
        AND (${status} IS NULL OR status = ${status})
        AND (${busca} IS NULL OR nome ILIKE ${"%" + (busca || "") + "%"} OR email ILIKE ${"%" + (busca || "") + "%"})
      ORDER BY created_at DESC
      LIMIT ${limite} OFFSET ${offset}
    `;

    const total = await sql`
      SELECT COUNT(*) as count FROM usuarios
      WHERE
        (${plano} IS NULL OR plano = ${plano})
        AND (${status} IS NULL OR status = ${status})
        AND (${busca} IS NULL OR nome ILIKE ${"%" + (busca || "") + "%"} OR email ILIKE ${"%" + (busca || "") + "%"})
    `;

    return NextResponse.json({ usuarios, total: Number(total[0].count), pagina, limite });
  } catch (err) {
    if (String(err).includes("Acesso negado")) {
      return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    }
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

// Ação sobre usuário específico (mudar plano, cancelar)
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { id, acao, plano } = await req.json();

    if (acao === "mudar_plano" && plano) {
      await sql`UPDATE usuarios SET plano = ${plano}, updated_at = NOW() WHERE id = ${id}`;
    } else if (acao === "cancelar") {
      await sql`UPDATE usuarios SET status = 'cancelado', updated_at = NOW() WHERE id = ${id}`;
    } else if (acao === "reativar") {
      await sql`UPDATE usuarios SET status = 'ativo', updated_at = NOW() WHERE id = ${id}`;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).includes("Acesso negado")) {
      return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    }
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
