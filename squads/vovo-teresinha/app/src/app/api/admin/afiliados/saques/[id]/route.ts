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

      // Marca como pagas as comissões disponíveis mais antigas primeiro (FIFO),
      // somando o valor real de cada uma (20/25/30, conforme tier) até cobrir o
      // valor do saque — antes assumia incorretamente R$20 fixo por comissão.
      const disponiveis = await sql`
        SELECT id, COALESCE(valor_comissao, valor, 0) as valor
        FROM comissoes
        WHERE afiliado_id = ${saque.afiliado_id} AND status IN ('liberado', 'aprovada')
        ORDER BY criado_em ASC
      `;

      const idsParaPagar: number[] = [];
      let acumulado = 0;
      for (const c of disponiveis) {
        if (acumulado >= saque.valor) break;
        idsParaPagar.push(c.id);
        acumulado += parseFloat(c.valor);
      }

      if (idsParaPagar.length > 0) {
        await sql`UPDATE comissoes SET status = 'pago' WHERE id = ANY(${idsParaPagar})`;
      }
    } else {
      await sql`UPDATE saques SET status = 'rejeitado' WHERE id = ${parseInt(id)}`;
    }

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/afiliados/saques/[id] PUT error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
