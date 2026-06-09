import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

// Calcula comissões para conversões recentes ainda sem comissão registrada
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Busca rastreamentos convertidos que ainda não geraram comissão
    const pendentes = await sql`
      SELECT
        r.id as rastreamento_id,
        r.afiliado_id,
        r.usuario_convertido_id,
        COALESCE(a.taxa_comissao, 20.00) as taxa_comissao,
        a.codigo_afiliado,
        a.nome as afiliado_nome
      FROM rastreamento_links r
      JOIN afiliados a ON a.id = r.afiliado_id
      WHERE r.converteu = TRUE
        AND r.usuario_convertido_id IS NOT NULL
        AND COALESCE(a.status, 'ativo') = 'ativo'
        AND NOT EXISTS (
          SELECT 1 FROM comissoes c
          WHERE c.rastreamento_id IS NOT NULL AND c.rastreamento_id = r.id
        )
      LIMIT 50
    `;

    const processadas: string[] = [];

    for (const p of pendentes) {
      // Busca a assinatura ativa do usuário convertido
      const [assinatura] = await sql`
        SELECT id, valor FROM assinaturas
        WHERE usuario_id = ${p.usuario_convertido_id}
          AND status = 'ativo'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      if (!assinatura) continue;

      const valorComissao = Number(assinatura.valor) * (Number(p.taxa_comissao) / 100);

      await sql`
        INSERT INTO comissoes (
          afiliado_id, rastreamento_id, assinatura_id, usuario_id,
          valor_assinatura, valor, taxa_comissao, valor_comissao, status
        ) VALUES (
          ${p.afiliado_id},
          ${p.rastreamento_id},
          ${assinatura.id},
          ${p.usuario_convertido_id},
          ${assinatura.valor},
          ${valorComissao.toFixed(2)},
          ${p.taxa_comissao},
          ${valorComissao.toFixed(2)},
          'pendente'
        )
      `;

      // Atualiza totais do afiliado
      await sql`
        UPDATE afiliados SET
          total_conversoes = total_conversoes + 1,
          total_comissao_gerada = total_comissao_gerada + ${valorComissao.toFixed(2)},
          atualizado_em = NOW()
        WHERE id = ${p.afiliado_id}
      `;

      processadas.push(`${p.afiliado_nome}: R$${valorComissao.toFixed(2)}`);
    }

    if (processadas.length > 0) {
      await enviarTelegram(
        `💰 <b>Comissões calculadas</b>\n\n` +
        processadas.map(c => `• ${c}`).join("\n")
      );
    }

    await resolverFalhas("calculador-comissao");
    return NextResponse.json({ ok: true, processadas: processadas.length });
  } catch (err) {
    await reportarFalha("calculador-comissao", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
