import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

// Aprova comissões pendentes após 7 dias sem cancelamento da assinatura
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Aprova comissões pendentes com usuário ainda com assinatura ativa há 7+ dias
    // Usa usuario_id como bridge (compatível com ambos os schemas de comissoes)
    const aprovadas = await sql`
      UPDATE comissoes c
      SET status = 'aprovada'
      WHERE c.status = 'pendente'
        AND COALESCE(c.criado_em, NOW() - INTERVAL '8 days') < NOW() - INTERVAL '7 days'
        AND EXISTS (
          SELECT 1 FROM assinaturas a
          WHERE a.usuario_id = c.usuario_id AND a.status = 'ativo'
        )
      RETURNING c.id, c.afiliado_id, COALESCE(c.valor_comissao, c.valor, 0) as valor_comissao
    `;

    // Cancela comissões de usuários que cancelaram assinatura
    const canceladas = await sql`
      UPDATE comissoes c
      SET status = 'cancelada'
      WHERE c.status = 'pendente'
        AND NOT EXISTS (
          SELECT 1 FROM assinaturas a
          WHERE a.usuario_id = c.usuario_id AND a.status = 'ativo'
        )
        AND c.usuario_id IS NOT NULL
      RETURNING c.id, c.afiliado_id
    `;

    if (aprovadas.length > 0) {
      const porAfiliado: Record<number, number> = {};
      for (const c of aprovadas) {
        porAfiliado[c.afiliado_id] = (porAfiliado[c.afiliado_id] || 0) + Number(c.valor_comissao);
      }

      const linhas: string[] = [];
      for (const [afiliadoId, total] of Object.entries(porAfiliado)) {
        const [af] = await sql`SELECT nome FROM afiliados WHERE id = ${Number(afiliadoId)}`;
        linhas.push(`• ${af?.nome || `#${afiliadoId}`}: R$${total.toFixed(2)}`);
      }

      await enviarTelegram(
        `✅ <b>Comissões aprovadas para pagamento</b>\n\n` +
        linhas.join("\n") +
        `\n\nTotal: ${aprovadas.length} comissão(ões)\n` +
        (canceladas.length > 0 ? `\n❌ ${canceladas.length} cancelada(s) por churn` : "")
      );
    }

    await resolverFalhas("confirmador-comissao");
    return NextResponse.json({
      ok: true,
      aprovadas: aprovadas.length,
      canceladas: canceladas.length,
    });
  } catch (err) {
    await reportarFalha("confirmador-comissao", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
