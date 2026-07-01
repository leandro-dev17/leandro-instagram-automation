/**
 * CONVERSOR CLÁUDIO FREE — Conversor de Usuários Free
 * Identifica usuários free que nunca assinaram (D+10, D+30) e envia campanha de conversão.
 * Dois estágios: lembrete suave (D+10) e oferta especial (D+30).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@receitinhasvovoteresi.com.br";

async function enviarEmail(para: string, assunto: string, html: string) {
  if (!BREVO_API_KEY) return;
  await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { email: BREVO_SENDER_EMAIL, name: "Vovó Teresinha" },
      to: [{ email: para }],
      subject: assunto,
      htmlContent: `<div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fff8f0;padding:32px;border-radius:12px;">${html}<p style="color:#999;font-size:12px;margin-top:32px;">Com carinho, Vovó Teresinha ❤️</p></div>`,
    }),
  });
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    let totalEnviados = 0;

    // Estágio D+10: lembrete suave
    const d10de  = new Date(Date.now() - 10.5 * 86400000).toISOString();
    const d10ate = new Date(Date.now() - 9.5  * 86400000).toISOString();
    const usuariosD10 = await sql`
      SELECT id, email, nome FROM usuarios
      WHERE tipo_usuario = 'free'
        AND criado_em BETWEEN ${d10de}::timestamptz AND ${d10ate}::timestamptz
        AND id NOT IN (SELECT usuario_id FROM assinaturas WHERE status IN ('ativo','cancelado','expirada'))
    ` as { id: number; email: string; nome: string }[];

    for (const u of usuariosD10) {
      const chave = `conversor_d10_${u.id}`;
      const jaEnviou = await sql`SELECT chave FROM app_configuracoes WHERE chave = ${chave}`;
      if (jaEnviou.length > 0) continue;
      try {
        await enviarEmail(
          u.email,
          "Psiu... você ainda não assinou! 🌸",
          `<p>Oi ${u.nome}! Já faz 10 dias que você se cadastrou nas Receitinhas da Vovó. 😊</p>
          <p>Assine o Caderninho por <strong>R$9,90/mês</strong> e tenha acesso às 80 receitinhas selecionadas pela Vovó, ou o Livro de Receitas completo por <strong>R$19,90/mês</strong> e tenha mais de 400 receitas, plano semanal automático e geladeira inteligente com IA!</p>
          <a href="${APP_URL}/assinar" style="display:inline-block;background:#c0392b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Quero assinar! 🌸</a>`
        );
        await sql`INSERT INTO app_configuracoes (chave, valor) VALUES (${chave}, ${new Date().toISOString()}) ON CONFLICT (chave) DO NOTHING`;
        totalEnviados++;
      } catch { /* silencioso */ }
    }

    // Estágio D+30: oferta especial
    const d30de  = new Date(Date.now() - 30.5 * 86400000).toISOString();
    const d30ate = new Date(Date.now() - 29.5 * 86400000).toISOString();
    const usuariosD30 = await sql`
      SELECT id, email, nome FROM usuarios
      WHERE tipo_usuario = 'free'
        AND criado_em BETWEEN ${d30de}::timestamptz AND ${d30ate}::timestamptz
        AND id NOT IN (SELECT usuario_id FROM assinaturas WHERE status IN ('ativo','cancelado','expirada'))
    ` as { id: number; email: string; nome: string }[];

    for (const u of usuariosD30) {
      const chave = `conversor_d30_${u.id}`;
      const jaEnviou = await sql`SELECT chave FROM app_configuracoes WHERE chave = ${chave}`;
      if (jaEnviou.length > 0) continue;
      try {
        await enviarEmail(
          u.email,
          "Último aviso: oferta especial pra você! 🎁",
          `<p>Querida ${u.nome},</p>
          <p>Já faz 30 dias desde que você se cadastrou e ainda não assinou nenhum dos planos da Vovó. 😢</p>
          <p>Que tal uma última chance? Assine o Livro de Receitas por apenas <strong>R$19,90/mês</strong> (7 dias grátis) ou o Caderninho por <strong>R$9,90/mês</strong>! Isso é menos do que um pão de queijo! 🧀</p>
          <a href="${APP_URL}/assinar" style="display:inline-block;background:#c0392b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Aproveitar Oferta 🎁</a>`
        );
        await sql`INSERT INTO app_configuracoes (chave, valor) VALUES (${chave}, ${new Date().toISOString()}) ON CONFLICT (chave) DO NOTHING`;
        totalEnviados++;
      } catch { /* silencioso */ }
    }

    if (totalEnviados > 0) {
      await enviarTelegram(
        `💰 <b>Conversor Free — Relatório</b>\n\n` +
        `✅ Campanhas de conversão enviadas: ${totalEnviados}\n` +
        `  • D+10: ${usuariosD10.length} elegíveis\n` +
        `  • D+30: ${usuariosD30.length} elegíveis`
      );
    }

    await resolverFalhas("conversor-free");
    return NextResponse.json({ ok: true, total_enviados: totalEnviados });
  } catch (err) {
    await reportarFalha("conversor-free", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
