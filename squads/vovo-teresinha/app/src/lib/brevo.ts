const BREVO_API_KEY = process.env.BREVO_API_KEY!;
const BREVO_SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@receitinhasvovoteresi.com.br";
const BREVO_SENDER_NAME = process.env.BREVO_SENDER_NAME || "Vovó Teresinha";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";

function emailHeader() {
  return `
    <div style="text-align:center;padding-bottom:24px;">
      <img src="${APP_URL}/selo-vovo.png" alt="Vovó Teresinha" width="100" height="100"
           style="border-radius:50%;border:3px solid #e67e22;object-fit:cover;" />
      <p style="margin:8px 0 0;font-family:Georgia,serif;color:#6b5842;font-size:15px;font-weight:bold;">
        Vovó Teresinha 👵
      </p>
    </div>
  `;
}

async function enviarEmail(para: string, assunto: string, html: string) {
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: {
      "api-key": BREVO_API_KEY,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      sender: { email: BREVO_SENDER_EMAIL, name: BREVO_SENDER_NAME },
      to: [{ email: para }],
      subject: assunto,
      htmlContent: html,
    }),
  });
  if (!res.ok) {
    const err = await res.text();
    console.error("Brevo error:", err);
  }
}

export async function enviarEmailTrialExpirando(email: string, nome: string, diasRestantes: number) {
  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fff8f0;padding:32px;border-radius:12px;">
      ${emailHeader()}
      <h1 style="color:#e67e22;font-size:24px;">Ei ${nome}, seu acesso expira em ${diasRestantes} dia${diasRestantes > 1 ? "s" : ""}!</h1>
      <p style="color:#555;font-size:16px;line-height:1.6;">
        Não quero que você fique sem suas receitinhas! Continue tendo acesso com o Caderninho por <strong>R$9,90/mês</strong> ou o Livro de Receitas completo por <strong>R$19,90/mês</strong>.
      </p>
      <a href="${APP_URL}/assinar" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;margin-top:16px;">
        Garantir meu Acesso Premium
      </a>
      <p style="color:#999;font-size:12px;margin-top:32px;">Com carinho, Vovó Teresinha ❤️</p>
    </div>
  `;
  await enviarEmail(email, `Seu acesso expira em ${diasRestantes} dia${diasRestantes > 1 ? "s" : ""}! ⏰`, html);
}

export async function enviarEmailRedefinirSenha(email: string, nome: string, token: string) {
  const link = `${APP_URL}/redefinir-senha?token=${token}`;
  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fff8f0;padding:32px;border-radius:12px;">
      ${emailHeader()}
      <h1 style="color:#c0392b;font-size:24px;">Redefinir sua senha, ${nome}</h1>
      <p style="color:#555;font-size:16px;line-height:1.6;">
        Recebemos um pedido de redefinição de senha. Clique no botão abaixo para criar uma nova senha. O link expira em 1 hora.
      </p>
      <a href="${link}" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;margin-top:16px;">
        Redefinir Senha
      </a>
      <p style="color:#999;font-size:14px;margin-top:24px;">Se você não solicitou isso, ignore este email.</p>
      <p style="color:#999;font-size:12px;margin-top:16px;">Com carinho, Vovó Teresinha ❤️</p>
    </div>
  `;
  await enviarEmail(email, "Redefinição de senha — Receitinhas da Vovó", html);
}

export async function enviarEmailBoasVindasAluna(email: string, nome: string, sexo: "M" | "F" = "F") {
  const bemVindo = sexo === "M" ? "Bem-vindo" : "Bem-vinda";
  const aluno = sexo === "M" ? "alunos" : "alunas";
  const artigo = sexo === "M" ? "os" : "as";
  const emoji = sexo === "M" ? "💪🏋️" : "🌸🏋️";
  const assunto = sexo === "M"
    ? "Bem-vindo às Receitinhas da Vovó Teresinha! 💪"
    : "Bem-vinda às Receitinhas da Vovó Teresinha! 🌸";

  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fff8f0;padding:32px;border-radius:12px;">
      ${emailHeader()}
      <h1 style="color:#c0392b;font-size:28px;">${bemVindo}, ${nome}! ${emoji}</h1>
      <p style="color:#555;font-size:16px;line-height:1.6;">
        Que alegria ter você aqui! Sou a Vovó Teresinha e o meu personal favorito — o Personal Leandro — preparou um espaço especial dentro do app só para ${artigo} ${aluno} dele.
      </p>
      <p style="color:#555;font-size:16px;line-height:1.6;">
        Você já tem acesso completo a todas as receitas, plano semanal, geladeira inteligente e muito mais. Nada de trial, nada de cobrança — é presente do personal! 🎁
      </p>
      <a href="${APP_URL}/receitas" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;margin-top:16px;">
        Ver Receitinhas da Vovó
      </a>
      <p style="color:#999;font-size:12px;margin-top:32px;">Com carinho, Vovó Teresinha ❤️</p>
    </div>
  `;
  await enviarEmail(email, assunto, html);
}

export async function enviarEmailPremiumAtivado(email: string, nome: string, plano: string) {
  const isLivro = plano === "livro_receitas";
  const planoLabel = isLivro ? "Livro de Receitas 📖" : "Caderninho 📒";
  const beneficios = isLivro
    ? "acesso a mais de 400 receitas, plano semanal automático, geladeira inteligente com IA e lista de compras integrada"
    : "acesso às 80 receitinhas selecionadas pela Vovó, com novidades toda semana";
  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fff8f0;padding:32px;border-radius:12px;">
      ${emailHeader()}
      <h1 style="color:#27ae60;font-size:24px;">Parabéns, ${nome}! Sua assinatura foi ativada! 🎉</h1>
      <p style="color:#555;font-size:16px;line-height:1.6;">
        Seu plano <strong>${planoLabel}</strong> foi ativado com sucesso! Agora você tem ${beneficios}.
      </p>
      <a href="${APP_URL}/receitas" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;margin-top:16px;">
        Explorar Receitas
      </a>
      <p style="color:#999;font-size:12px;margin-top:32px;">Com carinho, Vovó Teresinha ❤️</p>
    </div>
  `;
  await enviarEmail(email, `Sua assinatura ${planoLabel} foi ativada! 🎉`, html);
}

export async function enviarEmailCancelamento(email: string, nome: string) {
  const html = `
    <div style="font-family:Georgia,serif;max-width:600px;margin:0 auto;background:#fff8f0;padding:32px;border-radius:12px;">
      ${emailHeader()}
      <h1 style="color:#7f8c8d;font-size:24px;">Sentiremos sua falta, ${nome} 💔</h1>
      <p style="color:#555;font-size:16px;line-height:1.6;">
        Sua assinatura foi cancelada. Você ainda terá acesso às receitas gratuitas. Se mudar de ideia, estamos aqui!
      </p>
      <a href="${APP_URL}/assinar" style="display:inline-block;background:#c0392b;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-size:16px;margin-top:16px;">
        Reativar Assinatura
      </a>
      <p style="color:#999;font-size:12px;margin-top:32px;">Com carinho, Vovó Teresinha ❤️</p>
    </div>
  `;
  await enviarEmail(email, "Sua assinatura foi cancelada 💔", html);
}
