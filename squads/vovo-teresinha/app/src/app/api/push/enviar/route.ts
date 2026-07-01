import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import webpush from "web-push";

webpush.setVapidDetails(
  `mailto:${process.env.BREVO_SENDER_EMAIL || "admin@vovoteresinha.com"}`,
  process.env.VAPID_PUBLIC_KEY!,
  process.env.VAPID_PRIVATE_KEY!
);

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { titulo, corpo, url, usuario_ids } = await req.json();

    if (!titulo || !corpo) {
      return NextResponse.json({ erro: "Título e corpo são obrigatórios" }, { status: 400 });
    }

    let subscriptions;

    if (usuario_ids && Array.isArray(usuario_ids) && usuario_ids.length > 0) {
      subscriptions = await sql`
        SELECT endpoint, p256dh, auth FROM push_subscriptions
        WHERE usuario_id = ANY(${usuario_ids})
      `;
    } else {
      subscriptions = await sql`SELECT endpoint, p256dh, auth FROM push_subscriptions`;
    }

    const payload = JSON.stringify({ title: titulo, body: corpo, url: url || "/" });

    let sucesso = 0;
    let falha = 0;

    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(
          { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
          payload
        );
        sucesso++;
      } catch (e: unknown) {
        falha++;
        const status = (e as { statusCode?: number })?.statusCode;
        if (status === 410 || status === 404) {
          await sql`DELETE FROM push_subscriptions WHERE endpoint = ${sub.endpoint}`;
        }
      }
    }

    return NextResponse.json({ dados: { sucesso, falha, total: subscriptions.length } });
  } catch (err) {
    console.error("push/enviar error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
