import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

const BREVO_API_KEY = process.env.BREVO_API_KEY!;
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || "Alerta Patriota";
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "contato@alertapatriota.com.br";

// FASE 27.4: preços hardcoded aqui (R$59,90/mês e R$499/ano) nunca foram atualizados quando
// o preço real cobrado em produção (ver assinaturas/criar/route.ts e a landing page) mudou
// para R$9,90/mês (R$99/ano) e R$19,90/mês (R$199/ano) — o e-mail de confirmação prometia um
// valor muito maior do que o que de fato seria cobrado.
const NOMES_PLANO: Record<string, string> = {
  vip: "VIP Premium (R$9,90/mês ou R$99/ano)",
  elite: "Elite Global (R$19,90/mês ou R$199/ano)",
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      nome: string;
      email: string;
      telefone: string;
      plano: string;
    };

    const { nome, email, telefone, plano } = body;

    if (!nome?.trim() || !email?.trim() || !telefone?.trim()) {
      return NextResponse.json({ erro: "Preencha todos os campos obrigatórios" }, { status: 400 });
    }

    if (!["vip", "elite"].includes(plano)) {
      return NextResponse.json({ erro: "Plano inválido" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json({ erro: "E-mail inválido" }, { status: 400 });
    }

    await sql`
      INSERT INTO lista_espera (email, telefone, plano_desejado)
      VALUES (${email.toLowerCase().trim()}, ${telefone.trim()}, ${plano})
      ON CONFLICT DO NOTHING
    `;

    const nomePlano = NOMES_PLANO[plano] || plano;
    const primeiroNome = nome.split(" ")[0];

    await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "api-key": BREVO_API_KEY,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        sender: { name: BREVO_SENDER_NAME, email: BREVO_SENDER_EMAIL },
        to: [{ email: email.toLowerCase().trim(), name: nome.trim() }],
        subject: "✅ Você está na lista de espera — Alerta Patriota",
        htmlContent: `
<!DOCTYPE html>
<html>
<head><meta charset="UTF-8"></head>
<body style="background:#0d0d1a;color:#e8e8e8;font-family:Arial,sans-serif;margin:0;padding:0">
<div style="max-width:560px;margin:0 auto;padding:40px 24px">
  <div style="text-align:center;margin-bottom:32px">
    <span style="font-size:26px;font-weight:bold;color:#ffd700">⚡ ALERTA PATRIOTA</span>
  </div>
  <h2 style="color:#ffd700;font-size:20px;margin-bottom:12px">Confirmado, ${primeiroNome}! Você está na lista.</h2>
  <p style="color:#b0b0b0;font-size:15px;line-height:1.6;margin-bottom:16px">
    Sua inscrição na lista de espera para o grupo <strong style="color:#ffd700">${nomePlano}</strong> foi registrada com sucesso.
  </p>
  <div style="background:#12122a;border-left:4px solid #ffd700;padding:20px;border-radius:4px;margin-bottom:24px">
    <p style="color:#e8e8e8;margin:0;font-size:14px;line-height:1.7">
      📋 <strong>Nome:</strong> ${nome.trim()}<br>
      📧 <strong>E-mail:</strong> ${email.toLowerCase().trim()}<br>
      📱 <strong>WhatsApp:</strong> ${telefone.trim()}<br>
      🎯 <strong>Plano:</strong> ${nomePlano}
    </p>
  </div>
  <p style="color:#b0b0b0;font-size:15px;line-height:1.6">
    Quando uma vaga abrir, você será contactado <strong>neste e-mail e no WhatsApp informado</strong>. As vagas são liberadas por ordem de inscrição.
  </p>
  <p style="color:#666;font-size:13px;margin-top:32px">
    Alerta Patriota — Curadoria política conservadora brasileira
  </p>
</div>
</body>
</html>
        `,
      }),
    }).catch((err) => console.error("Brevo erro lista-espera:", err));

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('esther-espera', 'inscricao_lista_espera', 'sucesso',
        ${JSON.stringify({ email, plano, telefone })})
    `.catch(() => null);

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("lista-de-espera error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
