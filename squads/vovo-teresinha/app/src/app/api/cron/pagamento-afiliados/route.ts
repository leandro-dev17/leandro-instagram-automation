import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

// Executa no dia 1 de cada mês: consolida comissões aprovadas e notifica para pagamento manual
// (pagamento efetivo é manual via PIX/transferência até integrarmos gateway automático)
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Busca afiliados com comissões aprovadas e não pagas
    const resumo = await sql`
      SELECT
        a.id,
        a.nome,
        a.email,
        a.telefone,
        a.codigo_afiliado,
        COUNT(c.id) as qtd_comissoes,
        SUM(c.valor_comissao) as total_a_pagar
      FROM afiliados a
      JOIN comissoes c ON c.afiliado_id = a.id
      WHERE c.status = 'aprovada'
        AND a.status = 'ativo'
      GROUP BY a.id, a.nome, a.email, a.telefone, a.codigo_afiliado
      HAVING SUM(c.valor_comissao) >= 20.00
      ORDER BY total_a_pagar DESC
    `;

    if (resumo.length === 0) {
      return NextResponse.json({ ok: true, msg: "Nenhum afiliado com saldo para pagamento" });
    }

    const totalGeral = resumo.reduce((acc, r) => acc + Number(r.total_a_pagar), 0);

    const linhas = resumo.map(r =>
      `• <b>${r.nome}</b> — R$${Number(r.total_a_pagar).toFixed(2)}\n` +
      `  Email: ${r.email}${r.telefone ? ` | Tel: ${r.telefone}` : ""}`
    );

    await enviarTelegram(
      `💳 <b>Relatório de Pagamento de Afiliados</b>\n\n` +
      `${resumo.length} afiliado(s) aguardando pagamento:\n\n` +
      linhas.join("\n\n") +
      `\n\n💰 Total geral: R$${totalGeral.toFixed(2)}\n\n` +
      `⚠️ <b>Ação necessária:</b> Realize os pagamentos via PIX e depois confirme manualmente em /api/cron/pagamento-afiliados?confirmar=true&secret=...`
    );

    // Se o parâmetro confirmar=true estiver presente, marca as comissões como pagas
    const confirmar = req.nextUrl.searchParams.get("confirmar") === "true";
    if (confirmar) {
      const ids = resumo.map(r => r.id);
      await sql`
        UPDATE comissoes SET status = 'paga', pago_em = NOW()
        WHERE afiliado_id = ANY(${ids}) AND status = 'aprovada'
      `;

      await sql`
        UPDATE afiliados SET
          total_comissao_paga = total_comissao_paga + subq.total,
          atualizado_em = NOW()
        FROM (
          SELECT afiliado_id, SUM(valor_comissao) as total
          FROM comissoes
          WHERE status = 'paga' AND pago_em > NOW() - INTERVAL '1 minute'
          GROUP BY afiliado_id
        ) subq
        WHERE afiliados.id = subq.afiliado_id
      `;

      await enviarTelegram(
        `✅ <b>Pagamentos confirmados!</b>\n\n` +
        `${resumo.length} afiliado(s) marcados como pagos.\n` +
        `Total pago: R$${totalGeral.toFixed(2)}`
      );

      return NextResponse.json({ ok: true, pagos: resumo.length, total: totalGeral });
    }

    await resolverFalhas("pagamento-afiliados");
    return NextResponse.json({ ok: true, aguardando_pagamento: resumo.length, total: totalGeral });
  } catch (err) {
    await reportarFalha("pagamento-afiliados", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
