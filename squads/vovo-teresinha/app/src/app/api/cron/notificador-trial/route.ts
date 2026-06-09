/**
 * NOTIFICADOR NATASHA TRIAL — Notificadora de Trial Expirando
 * Usa usuarios.trial_fim (correto) para detectar trials que expiram em 48h.
 * Envia email + enfileira WhatsApp para cada usuário afetado (dedup por chave).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import { enviarEmailTrialExpirando } from "@/lib/brevo";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const em48h = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();

    // Query correta: usa usuarios.trial_fim, não assinaturas
    const expirando = await sql`
      SELECT id, email, nome, trial_fim FROM usuarios
      WHERE tipo_usuario = 'trial'
        AND trial_fim BETWEEN NOW() AND ${em48h}::timestamptz
      ORDER BY trial_fim ASC
    ` as { id: number; email: string; nome: string; trial_fim: Date }[];

    let notificados = 0;
    const erros: string[] = [];

    for (const usuario of expirando) {
      const chave = `trial_notificado_${usuario.id}`;

      // Dedup: não notifica duas vezes
      const jaNotificado = await sql`SELECT id FROM app_configuracoes WHERE chave = ${chave}`;
      if (jaNotificado.length > 0) continue;

      const diasRestantes = Math.max(1, Math.ceil(
        (new Date(usuario.trial_fim).getTime() - Date.now()) / 86400000
      ));

      try {
        // Email de trial expirando
        await enviarEmailTrialExpirando(usuario.email, usuario.nome, diasRestantes);

        // Enfileira WhatsApp (se usuário tiver telefone)
        const msg = `Olá ${usuario.nome}! 🌸 Seu período de avaliação gratuita da Vovó Teresinha expira em ${diasRestantes} dia${diasRestantes > 1 ? "s" : ""}. Assine agora e continue aproveitando todas as receitas exclusivas! 💜`;
        await sql`
          INSERT INTO whatsapp_fila (numero, mensagem, status)
          SELECT u.telefone, ${msg}, 'pendente'
          FROM usuarios u
          WHERE u.id = ${usuario.id}
            AND u.telefone IS NOT NULL
        `.catch(() => {}); // silencioso se não houver coluna telefone

        // Marca como notificado para não repetir
        await sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${chave}, ${new Date().toISOString()})
          ON CONFLICT (chave) DO NOTHING
        `;

        notificados++;
      } catch (e) {
        erros.push(`${usuario.email}: ${String(e).slice(0, 80)}`);
      }
    }

    if (notificados > 0 || erros.length > 0) {
      await enviarTelegram(
        `⏰ <b>Notificador Trial — Relatório</b>\n\n` +
        `Trials expirando em 48h: ${expirando.length}\n` +
        `✅ Notificados hoje: ${notificados}\n` +
        (erros.length > 0 ? `⚠️ Erros: ${erros.length}` : "")
      );
    }

    await resolverFalhas("notificador-trial");
    return NextResponse.json({
      ok: true,
      expirando: expirando.length,
      notificados,
      erros: erros.length,
    });
  } catch (err) {
    await reportarFalha("notificador-trial", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
