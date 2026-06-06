/**
 * AGENTE ENZO ENGAJAMENTO
 * Roda 1x/dia às 9h. Cuida de:
 * - Trial expirando em D-6: lembrete no WhatsApp
 * - Inativos 7 dias: e-mail de reativação
 * - Inativos 15 dias: WhatsApp do Capitão Braga
 * - Inativos 30 dias: oferta especial
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemPrivada } from "@/lib/whatsapp";
import { enviarEmailRecuperacao } from "@/lib/brevo";
import { alertarTelegram } from "@/lib/telegram";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  let acoes = 0;

  try {
    // ── 1. Trial expirando em 6 dias ─────────────────────────────────────
    const trialsD6 = await sql`
      SELECT id, nome, telefone, email FROM usuarios
      WHERE status = 'trial'
      AND trial_fim BETWEEN NOW() + INTERVAL '5 days' AND NOW() + INTERVAL '7 days'
      AND telefone IS NOT NULL
    `;

    for (const u of trialsD6) {
      const msg = `⏰ *${u.nome}, seus 7 dias estão acabando!*\n\nVocê ainda tem acesso ao Alerta Patriota por poucos dias. Não fique sem as notícias que a mídia esconde.\n\nManter minha assinatura: ${APP_URL}/assinar\n\n_Capitão Braga — Deus, Pátria e Família._`;
      await enviarMensagemPrivada(u.telefone, msg);
      acoes++;
    }

    // ── 2. Inativos 7 dias → e-mail ──────────────────────────────────────
    const inativos7 = await sql`
      SELECT id, nome, email FROM usuarios
      WHERE status = 'ativo'
      AND updated_at < NOW() - INTERVAL '7 days'
      AND id NOT IN (
        SELECT (detalhes->>'usuarioId')::int FROM agentes_log
        WHERE agente = 'enzo-engajamento' AND acao = 'inativo_7'
        AND created_at >= NOW() - INTERVAL '7 days'
        AND detalhes->>'usuarioId' IS NOT NULL
      )
      LIMIT 50
    `;

    for (const u of inativos7) {
      await enviarEmailRecuperacao(u.email, u.nome, 7).catch(() => {});
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('enzo-engajamento', 'inativo_7', 'sucesso', ${JSON.stringify({ usuarioId: u.id })})`;
      acoes++;
    }

    // ── 3. Inativos 15 dias → WhatsApp ───────────────────────────────────
    const inativos15 = await sql`
      SELECT id, nome, telefone FROM usuarios
      WHERE status = 'ativo' AND telefone IS NOT NULL
      AND updated_at < NOW() - INTERVAL '15 days'
      AND id NOT IN (
        SELECT (detalhes->>'usuarioId')::int FROM agentes_log
        WHERE agente = 'enzo-engajamento' AND acao = 'inativo_15'
        AND created_at >= NOW() - INTERVAL '15 days'
        AND detalhes->>'usuarioId' IS NOT NULL
      )
      LIMIT 30
    `;

    for (const u of inativos15) {
      const msg = `🇧🇷 *${u.nome}, está tudo bem?*\n\nO Capitão Braga notou que faz um tempo que você não aparece no grupo. O Brasil continua precisando de patriotas atentos!\n\nO grupo está cheio de novidades: ${APP_URL}\n\n_Deus, Pátria e Família — sempre._`;
      await enviarMensagemPrivada(u.telefone, msg);
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('enzo-engajamento', 'inativo_15', 'sucesso', ${JSON.stringify({ usuarioId: u.id })})`;
      acoes++;
    }

    // ── 4. Inativos 30 dias → oferta especial ────────────────────────────
    const inativos30 = await sql`
      SELECT id, nome, telefone FROM usuarios
      WHERE status = 'ativo' AND telefone IS NOT NULL
      AND updated_at < NOW() - INTERVAL '30 days'
      AND id NOT IN (
        SELECT (detalhes->>'usuarioId')::int FROM agentes_log
        WHERE agente = 'enzo-engajamento' AND acao = 'inativo_30'
        AND created_at >= NOW() - INTERVAL '30 days'
        AND detalhes->>'usuarioId' IS NOT NULL
      )
      LIMIT 20
    `;

    for (const u of inativos30) {
      const msg = `🎁 *${u.nome}, uma oferta especial para você voltar*\n\nSentimos sua falta no Alerta Patriota. Para você que esteve com a gente desde o início, temos uma condição especial.\n\nAcesse e veja: ${APP_URL}/assinar\n\n_Capitão Braga — Deus, Pátria e Família — sempre._`;
      await enviarMensagemPrivada(u.telefone, msg);
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('enzo-engajamento', 'inativo_30', 'sucesso', ${JSON.stringify({ usuarioId: u.id })})`;
      acoes++;
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms) VALUES ('enzo-engajamento', 'ciclo_completo', 'sucesso', ${JSON.stringify({ acoes })}, ${Date.now() - inicio})`;
    return NextResponse.json({ ok: true, acoes });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Enzo Engajamento", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
