import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { id } = await params;
    const { acao } = await req.json();

    if (!acao || !["aprovar", "rejeitar"].includes(acao)) {
      return NextResponse.json({ erro: "Ação inválida. Use: aprovar ou rejeitar" }, { status: 400 });
    }

    const saqueRows = await sql`
      SELECT s.id, s.valor, s.afiliado_id, s.status
      FROM saques s WHERE s.id = ${parseInt(id)} LIMIT 1
    `;

    if (saqueRows.length === 0) return NextResponse.json({ erro: "Saque não encontrado" }, { status: 404 });

    const saque = saqueRows[0];

    if (saque.status !== "pendente") {
      return NextResponse.json({ erro: "Saque já processado" }, { status: 400 });
    }

    if (acao === "aprovar") {
      await sql`UPDATE saques SET status = 'aprovado' WHERE id = ${parseInt(id)}`;
      await sql`
        UPDATE comissoes SET status = 'pago'
        WHERE afiliado_id = ${saque.afiliado_id} AND status = 'liberado'
        AND id IN (
          SELECT id FROM comissoes WHERE afiliado_id = ${saque.afiliado_id} AND status = 'liberado'
          ORDER BY created_at ASC
          LIMIT (SELECT CEIL(${saque.valor}::numeric / 20))
        )
      `;
    } else {
      await sql`UPDATE saques SET status = 'rejeitado' WHERE id = ${parseInt(id)}`;
    }

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/afiliados/saques/[id] PUT error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
