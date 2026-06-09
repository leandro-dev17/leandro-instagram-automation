/**
 * SEQUENCIADOR SÔNIA — Sequenciadora de Onboarding
 * Envia sequência de emails/WhatsApp nos dias D+1, D+3, D+6 após o cadastro.
 * Cada mensagem é personalizada e incentiva o uso do app.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const BREVO_API_KEY = process.env.BREVO_API_KEY || "";
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@receitinhasvovoteresi.com.br";

interface Etapa {
  dia: number;
  assunto: string;
  corpo: (nome: string) => string;
}

const ETAPAS: Etapa[] = [
  {
    dia: 1,
    assunto: "Já explorou as receitas da Vovó? 🍲",
    corpo: (nome) => `<p>Olá ${nome}! É a Vovó Teresinha aqui. 👵</p>
    <p>Ontem você se cadastrou e mal poderia esperar para te ver por aqui! Você já explorou nossas receitas?</p>
    <p>Começa pelas <strong>sopas e caldos</strong> — são as preferidas das minhas alunas nos dias frios!</p>
    <a href="${APP_URL}/receitas" style="display:inline-block;background:#c0392b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Ver Receitas 🍲</a>`,
  },
  {
    dia: 3,
    assunto: "Você já salvou alguma receita favorita? 💜",
    corpo: (nome) => `<p>Oi ${nome}! Sou eu, a Vovó Teresinha! 💜</p>
    <p>Já faz 3 dias que você está com a gente. Você sabia que pode salvar suas receitas favoritas?</p>
    <p>Clica no coraçãozinho ❤️ em qualquer receita para salvar. Assim fica fácil de achar depois!</p>
    <a href="${APP_URL}/receitas" style="display:inline-block;background:#c0392b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Salvar Favoritas 💜</a>`,
  },
  {
    dia: 6,
    assunto: "Seu acesso trial vai acabar em breve — continue conosco! 🌸",
    corpo: (nome) => `<p>Querida ${nome},</p>
    <p>Seu período de avaliação está quase acabando! Não perca acesso às mais de 200 receitas, plano semanal e geladeira inteligente.</p>
    <p>Assine por apenas <strong>R$29,90 a cada 3 meses</strong> (menos de R$10/mês!) 🎉</p>
    <a href="${APP_URL}/assinar" style="display:inline-block;background:#c0392b;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;">Garantir Acesso Premium 🌸</a>`,
  },
];

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

    for (const etapa of ETAPAS) {
      const de = new Date(Date.now() - (etapa.dia + 0.5) * 86400000).toISOString();
      const ate = new Date(Date.now() - (etapa.dia - 0.5) * 86400000).toISOString();

      // Busca usuários que se cadastraram exatamente nesse dia
      const usuarios = await sql`
        SELECT id, email, nome FROM usuarios
        WHERE criado_em BETWEEN ${de}::timestamptz AND ${ate}::timestamptz
          AND tipo_usuario != 'admin'
      ` as { id: number; email: string; nome: string }[];

      for (const u of usuarios) {
        const chave = `onboarding_d${etapa.dia}_${u.id}`;
        const jaEnviou = await sql`SELECT id FROM app_configuracoes WHERE chave = ${chave}`;
        if (jaEnviou.length > 0) continue;

        try {
          await enviarEmail(u.email, etapa.assunto, etapa.corpo(u.nome));
          await sql`
            INSERT INTO app_configuracoes (chave, valor)
            VALUES (${chave}, ${new Date().toISOString()})
            ON CONFLICT (chave) DO NOTHING
          `;
          totalEnviados++;
        } catch {
          // silencioso — não bloqueia os demais
        }
      }
    }

    if (totalEnviados > 0) {
      await enviarTelegram(
        `🌸 <b>Sequenciador Onboarding — Relatório</b>\n\n` +
        `✅ Emails de onboarding enviados hoje: ${totalEnviados}`
      );
    }

    await resolverFalhas("sequenciador-onboarding");
    return NextResponse.json({ ok: true, total_enviados: totalEnviados });
  } catch (err) {
    await reportarFalha("sequenciador-onboarding", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
