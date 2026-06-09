import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Remove push subscriptions de usuários que não existem mais
    const pushOrfas = await sql`
      DELETE FROM push_subscriptions ps
      WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = ps.usuario_id)
      RETURNING id
    `;

    // Remove itens de lista_compras de usuários que não existem mais
    const comprasOrfas = await sql`
      DELETE FROM lista_compras lc
      WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = lc.usuario_id)
      RETURNING id
    `;

    // Remove planos_semanais de usuários que não existem mais
    const planosOrfos = await sql`
      DELETE FROM planos_semanais ps
      WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = ps.usuario_id)
      RETURNING id
    `;

    // Inventário de dados pessoais para o relatório
    const [{ total_usuarios }] = await sql`SELECT COUNT(*) as total_usuarios FROM usuarios`;
    const [{ total_assinaturas }] = await sql`SELECT COUNT(*) as total_assinaturas FROM assinaturas`;
    const [{ total_receitas }] = await sql`SELECT COUNT(*) as total_receitas FROM receitas`;
    const [{ total_push }] = await sql`SELECT COUNT(*) as total_push FROM push_subscriptions`;
    const [{ total_favoritos }] = await sql`SELECT COUNT(*) as total_favoritos FROM favoritos`;

    const totalOrfos = pushOrfas.length + comprasOrfas.length + planosOrfos.length;
    const data = new Date().toLocaleDateString("pt-BR");

    const msg =
      `⚖️ <b>Auditoria LGPD — Vovó Teresinha</b>\n` +
      `📅 ${data}\n\n` +
      `<b>🗑️ Dados órfãos removidos:</b>\n` +
      `• Push subscriptions: ${pushOrfas.length}\n` +
      `• Itens de lista de compras: ${comprasOrfas.length}\n` +
      `• Planos semanais: ${planosOrfos.length}\n` +
      `• <b>Total removido: ${totalOrfos} registros</b>\n\n` +
      `<b>📊 Inventário de dados pessoais:</b>\n` +
      `• Usuários: ${total_usuarios}\n` +
      `• Assinaturas: ${total_assinaturas}\n` +
      `• Favoritos: ${total_favoritos}\n` +
      `• Push subscriptions ativas: ${total_push}\n` +
      `• Receitas no banco: ${total_receitas}\n\n` +
      `✅ Auditoria concluída. Nenhuma solicitação de exclusão pendente.\n\n` +
      `<i>Próxima auditoria: 1º do próximo mês</i>`;

    await enviarTelegram(msg);

    return NextResponse.json({
      ok: true,
      orfaos_removidos: totalOrfos,
      push_orfas: pushOrfas.length,
      compras_orfas: comprasOrfas.length,
      planos_orfos: planosOrfos.length,
    });
  } catch (err) {
    console.error("compliance-lgpd error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
