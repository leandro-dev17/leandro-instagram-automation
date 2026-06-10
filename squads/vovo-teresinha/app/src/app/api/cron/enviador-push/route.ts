/**
 * ENVIADOR ÉRICO PUSH — Enviador de Notificações Push
 * Busca assinantes com push ativo e envia notificação diária usando VAPID/web-push.
 * Corrige o problema de push-diario que coletava mas nunca enviava.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import webpush from "web-push";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const VAPID_PUBLIC = process.env.VAPID_PUBLIC_KEY || "";
const VAPID_PRIVATE = process.env.VAPID_PRIVATE_KEY || "";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  if (!VAPID_PUBLIC || !VAPID_PRIVATE) {
    return NextResponse.json({ ok: false, motivo: "VAPID keys não configuradas" });
  }

  webpush.setVapidDetails(`mailto:contato@receitinhasvovoteresi.com.br`, VAPID_PUBLIC, VAPID_PRIVATE);

  try {
    // Busca usuários com assinatura ativa e push subscription ativa
    const destinatarios = await sql`
      SELECT DISTINCT ON (pn.endpoint)
        u.id AS usuario_id, u.nome,
        pn.id AS sub_id, pn.endpoint, pn.p256dh AS chave_p256dh, pn.auth AS chave_auth
      FROM usuarios u
      JOIN push_subscriptions pn ON pn.usuario_id = u.id
      LEFT JOIN assinaturas a ON a.usuario_id = u.id AND a.status = 'ativo'
      WHERE pn.ativo = true
        AND (a.id IS NOT NULL OR u.tipo_usuario IN ('premium', 'trial'))
      LIMIT 300
    ` as { usuario_id: number; nome: string; sub_id: number; endpoint: string; chave_p256dh: string; chave_auth: string }[];

    // Busca receita do dia (mais recente)
    const [receitaDia] = await sql`
      SELECT id, titulo, descricao FROM receitas
      ORDER BY created_at DESC LIMIT 1
    `;

    const titulo = receitaDia
      ? `🍲 Receita do dia: ${receitaDia.titulo}`
      : "🍲 Vovó Teresinha tem novidades pra você!";

    const corpo = receitaDia
      ? `Olha essa delícia: ${String(receitaDia.descricao ?? "").slice(0, 80)}...`
      : "Acesse o app e veja as receitas de hoje! 💜";

    const payload = JSON.stringify({
      title: titulo,
      body: corpo,
      icon: `${APP_URL}/icon-512.png`,
      badge: `${APP_URL}/badge-72.png`,
      data: { url: receitaDia ? `${APP_URL}/receitas/${receitaDia.id}` : `${APP_URL}/receitas` },
    });

    let enviados = 0;
    const subscriptionsInvalidas: number[] = [];

    for (const dest of destinatarios) {
      const subscription = {
        endpoint: dest.endpoint,
        keys: { p256dh: dest.chave_p256dh, auth: dest.chave_auth },
      };

      try {
        await webpush.sendNotification(subscription, payload);
        enviados++;
      } catch (e: unknown) {
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 410 || status === 404) {
          // Subscription expirada/removida
          subscriptionsInvalidas.push(dest.sub_id);
        }
      }
    }

    // Desativa subscriptions inválidas
    if (subscriptionsInvalidas.length > 0) {
      await sql`UPDATE push_subscriptions SET ativo = false WHERE id = ANY(${subscriptionsInvalidas})`;
    }

    console.log(`[enviador-push] Enviados: ${enviados}/${destinatarios.length} | Inválidas: ${subscriptionsInvalidas.length}`);

    await resolverFalhas("enviador-push");
    return NextResponse.json({
      ok: true,
      enviados,
      destinatarios: destinatarios.length,
      subs_invalidas_removidas: subscriptionsInvalidas.length,
    });
  } catch (err) {
    await reportarFalha("enviador-push", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
