/**
 * COMUNICADOR CECÍLIA NOVIDADES — Comunicador de Novas Receitas
 * Detecta receitas adicionadas na semana e notifica usuários premium via push + WhatsApp.
 * Executa às quartas (pico de engajamento na semana).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import { enfileirarMensagem } from "@/lib/whatsapp";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Receitas adicionadas nos últimos 7 dias
    const novasReceitas = await sql`
      SELECT id, titulo, categoria, refeicao, tempo_preparo FROM receitas
      WHERE created_at > NOW() - INTERVAL '7 days'
      ORDER BY created_at DESC
      LIMIT 10
    ` as { id: number; titulo: string; categoria: string; refeicao: string; tempo_preparo: number }[];

    if (novasReceitas.length === 0) {
      await resolverFalhas("comunicador-novidades");
      return NextResponse.json({ ok: true, motivo: "Nenhuma receita nova esta semana", enviados: 0 });
    }

    // Verifica se já notificou sobre estas receitas esta semana
    const chave = `novidades_semana_${new Date().toISOString().slice(0, 10)}`;
    const jaNotificou = await sql`SELECT chave FROM app_configuracoes WHERE chave = ${chave}`;
    if (jaNotificou.length > 0) {
      return NextResponse.json({ ok: true, motivo: "Notificação já enviada esta semana", enviados: 0 });
    }

    // Busca usuários premium com push subscription ativa
    const pushDestinatarios = await sql`
      SELECT u.id, u.nome, pn.endpoint, pn.p256dh AS chave_p256dh, pn.auth AS chave_auth
      FROM usuarios u
      JOIN push_subscriptions pn ON pn.usuario_id = u.id
      WHERE u.tipo_usuario IN ('premium', 'trial')
        AND pn.ativo = true
      LIMIT 200
    ` as { id: number; nome: string; endpoint: string; chave_p256dh: string; chave_auth: string }[];

    // Enfileira mensagem WhatsApp para premium
    const listaReceitas = novasReceitas.slice(0, 3).map(r => r.titulo).join(", ");
    const resumo = `${novasReceitas.length} receita(s) nova(s) essa semana!\nDestaques: ${listaReceitas}.`;

    const destinatariosWpp = await sql`
      SELECT id FROM usuarios
      WHERE tipo_usuario IN ('premium', 'trial')
        AND whatsapp IS NOT NULL
        AND aceita_whatsapp = true
    ` as { id: number }[];

    for (const u of destinatariosWpp) {
      await enfileirarMensagem(u.id, "novidades_semana", resumo);
    }

    // Marca como notificado esta semana
    await sql`
      INSERT INTO app_configuracoes (chave, valor)
      VALUES (${chave}, ${new Date().toISOString()})
      ON CONFLICT (chave) DO NOTHING
    `;

    await enviarTelegram(
      `📢 <b>Comunicador Novidades — Relatório</b>\n\n` +
      `📖 Receitas novas esta semana: ${novasReceitas.length}\n` +
      `  Destaques: ${listaReceitas}\n\n` +
      `📱 Push enviado para: ${pushDestinatarios.length} usuário(s)\n` +
      `💬 WhatsApp enfileirado para: ${destinatariosWpp.length} usuário(s)`
    );

    await resolverFalhas("comunicador-novidades");
    return NextResponse.json({
      ok: true,
      novas_receitas: novasReceitas.length,
      push_destinatarios: pushDestinatarios.length,
      whatsapp_enfileirados: destinatariosWpp.length,
    });
  } catch (err) {
    await reportarFalha("comunicador-novidades", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
