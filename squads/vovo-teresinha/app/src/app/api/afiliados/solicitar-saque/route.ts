import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

const SAQUE_MINIMO = 30;

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { valor } = await req.json();

    if (!valor || valor < SAQUE_MINIMO) {
      return NextResponse.json({ erro: `Valor mínimo para saque é R$${SAQUE_MINIMO}` }, { status: 400 });
    }

    const afiRows = await sql`
      SELECT id, pix_chave FROM afiliados WHERE usuario_id = ${session.id} LIMIT 1
    `;

    if (afiRows.length === 0) {
      return NextResponse.json({ erro: "Você não está cadastrado como afiliado" }, { status: 404 });
    }

    const afiliado = afiRows[0];

    // INSERT...SELECT...WHERE faz a checagem de saldo e a gravação num único
    // statement, evitando a janela de corrida entre "consultar saldo" e "inserir
    // saque" que existia com 3 round-trips separados (duas requisições simultâneas
    // podiam ler o mesmo saldo disponível e ambas passar a validação).
    const result = await sql`
      INSERT INTO saques (afiliado_id, valor, status, pix_destino)
      SELECT ${afiliado.id}, ${valor}, 'pendente', ${afiliado.pix_chave}
      WHERE ${valor} <= (
        (SELECT COALESCE(SUM(valor), 0) FROM comissoes WHERE afiliado_id = ${afiliado.id} AND status IN ('liberado', 'aprovada'))
        -
        (SELECT COALESCE(SUM(valor), 0) FROM saques WHERE afiliado_id = ${afiliado.id} AND status = 'pendente')
      )
      RETURNING id, valor, status, created_at
    `;

    if (result.length === 0) {
      const liberadas = await sql`
        SELECT COALESCE(SUM(valor), 0) as total FROM comissoes WHERE afiliado_id = ${afiliado.id} AND status IN ('liberado', 'aprovada')
      `;
      const sacadosEmAnalise = await sql`
        SELECT COALESCE(SUM(valor), 0) as total FROM saques WHERE afiliado_id = ${afiliado.id} AND status = 'pendente'
      `;
      const disponivel = parseFloat(liberadas[0].total) - parseFloat(sacadosEmAnalise[0].total);
      return NextResponse.json({ erro: `Saldo disponível insuficiente. Disponível: R$${disponivel.toFixed(2)}` }, { status: 400 });
    }

    return NextResponse.json({ dados: result[0] }, { status: 201 });
  } catch (err) {
    console.error("afiliados/solicitar-saque error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
