import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const afiRows = await sql`
      SELECT id, codigo, cpf, pix_chave, tier, created_at
      FROM afiliados WHERE usuario_id = ${session.id} LIMIT 1
    `;

    if (afiRows.length === 0) {
      return NextResponse.json({ erro: "Não cadastrado como afiliado", cadastrado: false }, { status: 404 });
    }

    const afiliado = afiRows[0];

    const comissoes = await sql`
      SELECT status, SUM(valor) as total, COUNT(*) as count
      FROM comissoes WHERE afiliado_id = ${afiliado.id}
      GROUP BY status
    `;

    const saques = await sql`
      SELECT status, SUM(valor) as total FROM saques
      WHERE afiliado_id = ${afiliado.id}
      GROUP BY status
    `;

    const saldoPendente = comissoes.find((c: { status: string }) => c.status === "pendente")?.total || 0;
    const saldoDisponivel = comissoes.find((c: { status: string }) => c.status === "liberado")?.total || 0;
    const totalSacado = saques.find((s: { status: string }) => s.status === "aprovado")?.total || 0;
    const totalConversoes = comissoes.reduce((a: number, c: { count: string }) => a + parseInt(c.count), 0);

    return NextResponse.json({
      dados: {
        ...afiliado,
        saldo_pendente: parseFloat(saldoPendente),
        saldo_disponivel: parseFloat(saldoDisponivel),
        total_sacado: parseFloat(totalSacado),
        total_conversoes: totalConversoes,
      },
    });
  } catch (err) {
    console.error("afiliados/minha-conta error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
