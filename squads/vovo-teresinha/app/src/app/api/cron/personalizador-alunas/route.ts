import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import webpush from "web-push";

// Envia push personalizado para cada aluna baseado nos seus favoritos
// Tipo: "Vovó separou uma receita especialmente para você!"

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  if (!process.env.VAPID_PUBLIC_KEY || !process.env.VAPID_PRIVATE_KEY) {
    return NextResponse.json({ ok: false, msg: "VAPID não configurado" });
  }

  webpush.setVapidDetails(
    `mailto:${process.env.BREVO_SENDER_EMAIL || "admin@vovoteresinha.com"}`,
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  try {
    // Alunas do personal com push subscription
    const alunas = await sql`
      SELECT u.id, u.nome, ps.endpoint, ps.p256dh, ps.auth
      FROM usuarios u
      INNER JOIN push_subscriptions ps ON ps.usuario_id = u.id
      WHERE u.tipo_usuario = 'aluna_leandro'
    ` as { id: number; nome: string; endpoint: string; p256dh: string; auth: string }[];

    if (alunas.length === 0) {
      await resolverFalhas("personalizador-alunas");
      return NextResponse.json({ ok: true, msg: "Nenhuma aluna com push ativo" });
    }

    let enviados = 0;
    let erros = 0;

    for (const aluna of alunas) {
      // Categoria mais favoritada pela aluna
      const cats = await sql`
        SELECT r.categoria, COUNT(*) as total
        FROM favoritos f
        INNER JOIN receitas r ON r.id = f.receita_id
        WHERE f.usuario_id = ${aluna.id}
        GROUP BY r.categoria
        ORDER BY total DESC
        LIMIT 1
      ` as { categoria: string }[];

      const categoriaFavorita = cats[0]?.categoria ?? null;

      // Buscar uma receita nova nessa categoria (não favoritada ainda)
      let receita = null;
      if (categoriaFavorita) {
        const rows = await sql`
          SELECT r.id, r.titulo FROM receitas r
          WHERE r.categoria = ${categoriaFavorita}
            AND r.id NOT IN (
              SELECT receita_id FROM favoritos WHERE usuario_id = ${aluna.id}
            )
          ORDER BY RANDOM()
          LIMIT 1
        `;
        receita = rows[0] ?? null;
      }

      // Fallback: qualquer receita premium não favoritada
      if (!receita) {
        const rows = await sql`
          SELECT r.id, r.titulo FROM receitas r
          WHERE r.is_premium = true
            AND r.id NOT IN (
              SELECT receita_id FROM favoritos WHERE usuario_id = ${aluna.id}
            )
          ORDER BY RANDOM()
          LIMIT 1
        `;
        receita = rows[0] ?? null;
      }

      if (!receita) continue;

      const nomeAluna = aluna.nome.split(" ")[0]; // primeiro nome
      const payload = JSON.stringify({
        title: `A Vovó pensou em você, ${nomeAluna}! 💕`,
        body: receita.titulo,
        url: `/receitas/${receita.id}`,
      });

      try {
        await webpush.sendNotification(
          { endpoint: aluna.endpoint, keys: { p256dh: aluna.p256dh, auth: aluna.auth } },
          payload
        );
        enviados++;
      } catch {
        erros++;
        await sql`DELETE FROM push_subscriptions WHERE endpoint = ${aluna.endpoint}`.catch(() => null);
      }
    }

    await enviarTelegram(
      `💕 <b>Personalizador de Alunas</b>\n\n` +
      `Pushes enviados: ${enviados} de ${alunas.length} alunas\n` +
      `${erros > 0 ? `Erros: ${erros}\n` : ""}` +
      `<i>Receita personalizada baseada nos favoritos de cada uma.</i>`
    );

    await resolverFalhas("personalizador-alunas");
    return NextResponse.json({ ok: true, enviados, erros, total: alunas.length });
  } catch (err) {
    await reportarFalha("personalizador-alunas", String(err));
    return NextResponse.json({ erro: "Erro no personalizador", detalhes: String(err) }, { status: 500 });
  }
}
