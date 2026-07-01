import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    await requireAdmin();

    const { searchParams } = new URL(req.url);
    const pagina = parseInt(searchParams.get("pagina") || "1");
    const limite = Math.min(parseInt(searchParams.get("limite") || "50"), 500);
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

// Ação em lote sobre usuário (somente mudar_plano — cancelar/reativar exigem
// cancelar a cobrança recorrente no Mercado Pago e remover do grupo WhatsApp,
// por isso vivem só em /api/admin/usuarios/[id], nunca duplicar essa lógica aqui).
export async function PATCH(req: NextRequest) {
  try {
    await requireAdmin();
    const { id, acao, plano } = await req.json();

    if (acao === "mudar_plano" && plano) {
      // FASE 24: sem isto, qualquer valor era gravado sem validação — getInstancia()/
      // GROUP_IDS em lib/whatsapp.ts fazem fallback silencioso para VIP quando
      // plano !== "elite", divergindo do que o financeiro reporta (admin/financeiro,
      // admin/stats somam 0 para plano fora do enum). Mesmo padrão já usado no webhook MP.
      if (!["vip", "elite"].includes(plano)) {
        return NextResponse.json({ erro: "Plano inválido — use 'vip' ou 'elite'" }, { status: 400 });
      }
      await sql`UPDATE usuarios SET plano = ${plano}, updated_at = NOW() WHERE id = ${id}`;
    } else {
      return NextResponse.json({ erro: "Ação não suportada neste endpoint. Use /api/admin/usuarios/[id]." }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).includes("Acesso negado")) {
      return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    }
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
