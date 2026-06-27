import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { enviarMensagemPrivada } from "@/lib/whatsapp";

const BREVO_API_KEY = process.env.BREVO_API_KEY!;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || "Alerta Patriota";
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "contato@alertapatriota.com.br";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

async function enviarEmail(to: string, subject: string, html: string): Promise<boolean> {
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: to }],
        subject,
        htmlContent: html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

function htmlEmail1(nome: string, plano: string): string {
  const firstName = nome ? nome.split(" ")[0] : "Patriota";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#0d0d1a;color:#e8e8e8;font-family:Arial,sans-serif;margin:0;padding:0">
<div style="max-width:600px;margin:0 auto;padding:32px 24px">
  <div style="text-align:center;margin-bottom:32px">
    <span style="font-size:28px;font-weight:bold;color:#ffd700">&#9889; ALERTA PATRIOTA</span>
  </div>
  <h2 style="color:#ffd700;font-size:22px;margin-bottom:8px">Voc&#234; viu a not&#237;cia de hoje, ${firstName}?</h2>
  <p style="color:#b0b0b0;font-size:15px;line-height:1.6">Enquanto a m&#237;dia mainstream <strong style="color:#c0392b">esconde</strong> o que realmente acontece no Brasil, nosso grupo de WhatsApp j&#225; recebeu 3 an&#225;lises exclusivas hoje.</p>
  <div style="background:#1a1a2e;border-left:4px solid #c0392b;padding:20px;margin:24px 0;border-radius:4px">
    <p style="color:#ffd700;font-weight:bold;margin:0 0 8px">HOJE NO GRUPO:</p>
    <p style="color:#e8e8e8;margin:0;font-size:14px">"O Capit&#227;o Braga revelou o que os bastidores do Senado est&#227;o tramando &#8212; e as implica&#231;&#245;es para sua carteira nos pr&#243;ximos 60 dias."</p>
  </div>
  <p style="color:#b0b0b0;font-size:15px">Membros do plano <strong style="color:#ffd700">${plano || "Patriota"}</strong> j&#225; est&#227;o lendo. Voc&#234; ainda n&#227;o.</p>
  <div style="text-align:center;margin:32px 0">
    <a href="${APP_URL}/assinar?plano=${plano || "vip"}" style="background:#c0392b;color:#fff;padding:16px 36px;text-decoration:none;font-size:16px;font-weight:bold;border-radius:4px;display:inline-block">QUERO RECEBER AGORA</a>
  </div>
  <p style="color:#555;font-size:12px;text-align:center">7 dias por apenas R$1. Cancele quando quiser.</p>
</div>
</body>
</html>
`;
}

function htmlEmail2(nome: string, plano: string): string {
  const firstName = nome ? nome.split(" ")[0] : "Patriota";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#0d0d1a;color:#e8e8e8;font-family:Arial,sans-serif;margin:0;padding:0">
<div style="max-width:600px;margin:0 auto;padding:32px 24px">
  <div style="text-align:center;margin-bottom:32px">
    <span style="font-size:28px;font-weight:bold;color:#ffd700">&#9889; ALERTA PATRIOTA</span>
  </div>
  <div style="background:#c0392b;padding:12px 20px;border-radius:4px;margin-bottom:24px;text-align:center">
    <span style="color:#fff;font-weight:bold;font-size:14px">VAGAS LIMITADAS &#8212; GRUPO QUASE CHEIO</span>
  </div>
  <h2 style="color:#ffd700;font-size:22px;margin-bottom:8px">${firstName}, o grupo pode fechar novas vagas</h2>
  <p style="color:#b0b0b0;font-size:15px;line-height:1.6">Nosso grupo ${plano || "Patriota"} tem limite de membros para manter a qualidade da curadoria. Neste momento, <strong style="color:#c0392b">s&#243; restam algumas vagas</strong>.</p>
  <div style="background:#1a1a2e;padding:20px;margin:24px 0;border-radius:4px">
    <p style="color:#ffd700;font-weight:bold;margin:0 0 16px">O QUE MEMBROS DIZEM:</p>
    <p style="color:#e8e8e8;font-style:italic;margin:0 0 12px;font-size:14px">"Finalmente um grupo que fala a verdade sem rodeios." &#8212; <strong>Carlos M., RS</strong></p>
    <p style="color:#e8e8e8;font-style:italic;margin:0;font-size:14px">"O Capit&#227;o Braga analisa as not&#237;cias de um jeito que nenhum jornalista tem coragem." &#8212; <strong>Ana P., SP</strong></p>
  </div>
  <div style="text-align:center;margin:32px 0">
    <a href="${APP_URL}/assinar?plano=${plano || "vip"}" style="background:#ffd700;color:#0d0d1a;padding:16px 36px;text-decoration:none;font-size:16px;font-weight:bold;border-radius:4px;display:inline-block">GARANTIR MINHA VAGA AGORA</a>
  </div>
  <p style="color:#555;font-size:12px;text-align:center">Quando as vagas fecharem, voc&#234; vai para a lista de espera.</p>
</div>
</body>
</html>
`;
}

function htmlEmail3(nome: string, plano: string): string {
  const firstName = nome ? nome.split(" ")[0] : "Patriota";
  const precos: Record<string, string> = { vip: "R$9,90", elite: "R$19,90" };
  const preco = precos[plano] || "R$9,90";
  return `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#0d0d1a;color:#e8e8e8;font-family:Arial,sans-serif;margin:0;padding:0">
<div style="max-width:600px;margin:0 auto;padding:32px 24px">
  <div style="text-align:center;margin-bottom:32px">
    <span style="font-size:28px;font-weight:bold;color:#ffd700">&#9889; ALERTA PATRIOTA</span>
  </div>
  <div style="background:#c0392b;padding:16px 20px;border-radius:4px;margin-bottom:24px;text-align:center">
    <span style="color:#fff;font-weight:bold;font-size:16px">ULTIMA CHANCE &#8212; PRECO FUNDADOR ACABA HOJE</span>
  </div>
  <h2 style="color:#ffd700;font-size:22px;margin-bottom:8px">${firstName}, isso e sério.</h2>
  <p style="color:#b0b0b0;font-size:15px;line-height:1.6">Este é o último e-mail que vou te enviar. O preço de fundador do plano <strong style="color:#ffd700">${plano || "Patriota"}</strong> por <strong style="color:#ffd700">${preco}/mês</strong> encerra hoje à meia-noite.</p>
  <div style="background:#1a1a2e;border:2px solid #ffd700;padding:24px;margin:24px 0;border-radius:4px;text-align:center">
    <p style="color:#b0b0b0;margin:0 0 8px;font-size:13px;text-decoration:line-through">Preco normal: R$49,90/mes</p>
    <p style="color:#ffd700;font-size:36px;font-weight:bold;margin:0 0 8px">${preco}/mes</p>
    <p style="color:#b0b0b0;margin:0;font-size:13px">+ 7 dias gratis para testar</p>
  </div>
  <div style="text-align:center;margin:32px 0">
    <a href="${APP_URL}/assinar?plano=${plano || "vip"}&utm_source=email3" style="background:#c0392b;color:#fff;padding:18px 40px;text-decoration:none;font-size:18px;font-weight:bold;border-radius:4px;display:inline-block">ENTRAR COM PRECO FUNDADOR</a>
  </div>
  <p style="color:#555;font-size:12px;text-align:center">Alerta Patriota &#8212; Curadoria politica conservadora brasileira.</p>
</div>
</body>
</html>
`;
}

function msgWhatsApp1(nome: string, plano: string): string {
  const firstName = nome ? nome.split(" ")[0] : "Patriota";
  return `⚡ *${firstName}, você viu a notícia de hoje?*\n\nEnquanto a mídia esconde, o grupo já recebeu análises exclusivas do Capitão Braga hoje.\n\n🔴 A mídia está comprada. Quem pensa certo precisa se unir.\n\n👉 ${APP_URL}/assinar?plano=${plano || "vip"}\n\n_7 dias por R$1. Cancele quando quiser._`;
}

function msgWhatsApp2(nome: string, plano: string): string {
  const firstName = nome ? nome.split(" ")[0] : "Patriota";
  return `🔴 *${firstName}, o grupo pode fechar novas vagas*\n\nMantemos um número limitado de membros para garantir qualidade. Restam poucas vagas no grupo ${plano || "Patriota"}.\n\n👉 Garantir minha vaga: ${APP_URL}/assinar?plano=${plano || "vip"}`;
}

function msgWhatsApp3(nome: string, plano: string): string {
  const firstName = nome ? nome.split(" ")[0] : "Patriota";
  const precos: Record<string, string> = { vip: "R$9,90", elite: "R$19,90" };
  const preco = precos[plano] || "R$9,90";
  return `🏆 *${firstName}, é hoje — preço fundador acaba à meia-noite*\n\nDe R$49,90 por apenas ${preco}/mês + 7 dias grátis.\n\n👉 ${APP_URL}/assinar?plano=${plano || "vip"}&utm_source=whatsapp3`;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const leads = await sql`
      SELECT id, email, telefone, nome, plano_interesse,
             ultimo_email_enviado, ultimo_whatsapp_enviado, created_at
      FROM leads
      WHERE convertido = false
        AND created_at >= NOW() - INTERVAL '72 hours'
    `;

    let enviados = 0;
    const erros: string[] = [];

    for (const lead of leads) {
      const horasDesde = (Date.now() - new Date(lead.created_at as string).getTime()) / 3600000;
      const ultimoEmail = (lead.ultimo_email_enviado as number) ?? 0;
      const ultimoWpp = (lead.ultimo_whatsapp_enviado as number) ?? 0;
      const plano = (lead.plano_interesse as string) || "vip";
      const nome = (lead.nome as string) || "Patriota";

      // ── e-mails (só se tiver e-mail cadastrado) ──────────────────────
      if (lead.email) {
        let emailNum = 0;
        let subject = "";
        let html = "";

        if (horasDesde < 24 && ultimoEmail === 0) {
          emailNum = 1;
          subject = "Voce viu a noticia de hoje? [Alerta Patriota]";
          html = htmlEmail1(nome, plano);
        } else if (horasDesde >= 24 && horasDesde < 48 && ultimoEmail === 1) {
          emailNum = 2;
          subject = "O grupo pode fechar novas vagas [Alerta Patriota]";
          html = htmlEmail2(nome, plano);
        } else if (horasDesde >= 48 && ultimoEmail === 2) {
          emailNum = 3;
          subject = "Ultima chance — preco fundador acaba hoje [Alerta Patriota]";
          html = htmlEmail3(nome, plano);
        }

        if (emailNum > 0) {
          const ok = await enviarEmail(lead.email as string, subject, html);
          if (ok) {
            await sql`
              UPDATE leads SET ultimo_email_enviado = ${emailNum}, email_enviado_at = NOW()
              WHERE id = ${lead.id}
            `;
            await sql`
              INSERT INTO agentes_log (agente, acao, status, detalhes)
              VALUES ('esther-sequencia', 'email_enviado', 'sucesso',
                ${JSON.stringify({ email: lead.email, emailNum, plano })})
            `;
            enviados++;
          } else {
            erros.push(`email:${lead.email}`);
          }
        }
      }

      // ── WhatsApp (só se tiver telefone cadastrado) ────────────────────
      if (lead.telefone) {
        let wppNum = 0;
        let msg = "";

        if (horasDesde < 24 && ultimoWpp === 0) {
          wppNum = 1;
          msg = msgWhatsApp1(nome, plano);
        } else if (horasDesde >= 24 && horasDesde < 48 && ultimoWpp === 1) {
          wppNum = 2;
          msg = msgWhatsApp2(nome, plano);
        } else if (horasDesde >= 48 && ultimoWpp === 2) {
          wppNum = 3;
          msg = msgWhatsApp3(nome, plano);
        }

        if (wppNum > 0) {
          const ok = await enviarMensagemPrivada(lead.telefone as string, msg, plano);
          if (ok) {
            await sql`
              UPDATE leads SET ultimo_whatsapp_enviado = ${wppNum}, whatsapp_enviado_at = NOW()
              WHERE id = ${lead.id}
            `;
            await sql`
              INSERT INTO agentes_log (agente, acao, status, detalhes)
              VALUES ('esther-sequencia', 'whatsapp_enviado', 'sucesso',
                ${JSON.stringify({ telefone: lead.telefone, wppNum, plano })})
            `;
            enviados++;
          } else {
            erros.push(`wpp:${lead.telefone}`);
          }
        }
      }
    }

    if (enviados > 0) {
      await alertarTelegram("🟢", "Sequência Não-Conversão", `${enviados} mensagens enviadas (e-mail + WhatsApp). Erros: ${erros.length}`);
    }

    return NextResponse.json({ ok: true, leads_processados: leads.length, enviados, erros });
  } catch (err) {
    console.error("sequencia-nao-conversao error:", err);
    await alertarTelegram("🔴", "ERRO Sequência Não-Conversão", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
