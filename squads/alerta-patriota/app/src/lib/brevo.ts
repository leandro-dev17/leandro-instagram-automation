const BREVO_KEY = process.env.BREVO_API_KEY;
const SENDER_NAME = process.env.BREVO_SENDER_NAME || "Alerta Patriota";
const SENDER_EMAIL = process.env.BREVO_SENDER_EMAIL || "noreply@alertapatriota.com.br";

function escaparHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

async function enviarEmail(to: string, nome: string, subject: string, html: string): Promise<boolean> {
  if (!BREVO_KEY) return false;
  try {
    const res = await fetch("https://api.brevo.com/v3/smtp/email", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-key": BREVO_KEY,
      },
      body: JSON.stringify({
        sender: { name: SENDER_NAME, email: SENDER_EMAIL },
        to: [{ email: to, name: nome }],
        subject,
        htmlContent: html,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function enviarEmailBoasVindas(email: string, nome: string, plano: string, linkGrupo: string): Promise<boolean> {
  const nomeSeguro = escaparHtml(nome);
  const subject = "🇧🇷 Bem-vindo ao Alerta Patriota!";
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#1a1a2e;color:white;padding:40px;border-radius:12px">
      <h1 style="color:#ffd700">🇧🇷 Alerta Patriota</h1>
      <p>Olá, <strong>${nomeSeguro}</strong>!</p>
      <p>Sua assinatura do plano <strong>${plano.toUpperCase()}</strong> foi ativada com sucesso.</p>
      <p>Acesse seu grupo exclusivo pelo link abaixo:</p>
      <a href="${linkGrupo}" style="display:inline-block;background:#ffd700;color:#1a1a2e;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
        📲 Entrar no Grupo WhatsApp
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:32px">Deus, Pátria e Família — sempre.<br>Capitão Braga</p>
    </div>
  `;
  return enviarEmail(email, nome, subject, html);
}

export async function enviarEmailCancelamento(email: string, nome: string): Promise<boolean> {
  const nomeSeguro = escaparHtml(nome);
  const subject = "Sua assinatura foi cancelada";
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px">
      <h2>Olá, ${nomeSeguro}</h2>
      <p>Sua assinatura do Alerta Patriota foi cancelada.</p>
      <p>Sentiremos sua falta. Se quiser voltar a qualquer momento, acesse:</p>
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/assinar" style="color:#1a1a2e;font-weight:bold">alertapatriota.com.br/assinar</a>
      <p>Capitão Braga</p>
    </div>
  `;
  return enviarEmail(email, nome, subject, html);
}

export async function enviarEmailInadimplente(email: string, nome: string): Promise<boolean> {
  const nomeSeguro = escaparHtml(nome);
  const subject = "⚠️ Problema com seu pagamento — Alerta Patriota";
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;padding:40px">
      <h2>⚠️ Olá, ${nomeSeguro}</h2>
      <p>Identificamos um problema com o pagamento da sua assinatura do Alerta Patriota.</p>
      <p>Para não perder acesso ao grupo, regularize agora:</p>
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/assinar" style="display:inline-block;background:#c53030;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold">
        Regularizar Pagamento
      </a>
      <p>Capitão Braga</p>
    </div>
  `;
  return enviarEmail(email, nome, subject, html);
}

export async function enviarEmailRecuperacao(email: string, nome: string, dia: number): Promise<boolean> {
  const nomeSeguro = escaparHtml(nome);
  const subject = `${nome.replace(/[\r\n]/g, '')}, o Capitão Braga está com saudade`;
  const html = `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#1a1a2e;color:white;padding:40px;border-radius:12px">
      <h2 style="color:#ffd700">🇧🇷 Volte para o grupo, ${nomeSeguro}!</h2>
      <p>Faz ${dia} dia${dia > 1 ? "s" : ""} que você saiu do Alerta Patriota.</p>
      <p>Enquanto isso, muita coisa aconteceu e os patriotas do grupo ficaram sabendo antes de todo mundo.</p>
      <a href="${process.env.NEXT_PUBLIC_APP_URL}/assinar" style="display:inline-block;background:#ffd700;color:#1a1a2e;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;margin:16px 0">
        🇧🇷 Voltar ao Grupo
      </a>
      <p style="color:#aaa;font-size:12px">Deus, Pátria e Família — sempre.<br>Capitão Braga</p>
    </div>
  `;
  return enviarEmail(email, nome, subject, html);
}

// ─── REENGAJAMENTO DE INATIVOS (ONDAS D5/D10/D15/D20/D25/D30) ──────────────────

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

function htmlBaseReengajamento(titulo: string, corpo: string, ctaTexto: string, ctaLink: string, corBorda = "#ffd700"): string {
  return `
    <div style="font-family:sans-serif;max-width:600px;margin:0 auto;background:#1a1a2e;color:white;padding:40px;border-radius:12px;border:1px solid ${corBorda}33">
      <h2 style="color:#ffd700;margin-top:0">${titulo}</h2>
      ${corpo}
      <a href="${ctaLink}" style="display:inline-block;background:#ffd700;color:#1a1a2e;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold;margin:20px 0">
        ${ctaTexto}
      </a>
      <p style="color:#aaa;font-size:12px;margin-top:16px">Deus, Pátria e Família — sempre.<br>Capitão Braga</p>
    </div>
  `;
}

export async function enviarEmailReengajamento(email: string, nome: string, onda: 5 | 10 | 15 | 20 | 25 | 30): Promise<boolean> {
  const firstName = escaparHtml(nome ? nome.split(" ")[0] : "Patriota");

  let subject = "";
  let html = "";

  switch (onda) {
    case 5:
      subject = "Sentimos sua falta no Alerta Patriota";
      html = htmlBaseReengajamento(
        `🇧🇷 Sentimos sua falta, ${firstName}!`,
        `<p>Faz 5 dias que você não dá sinal de vida no Alerta Patriota.</p>
         <p>Enquanto isso, o grupo continua recebendo as análises do Capitão Braga sobre o que a mídia esconde — e você está perdendo.</p>`,
        "🇧🇷 Voltar a receber agora",
        `${APP_URL}`
      );
      break;
    case 10:
      subject = "Você perdeu análises importantes esta semana";
      html = htmlBaseReengajamento(
        `📰 ${firstName}, muita coisa aconteceu essa semana`,
        `<p>O Capitão Braga comentou os principais acontecimentos dos últimos dias e o grupo debateu tudo em tempo real.</p>
         <p>Quem ficou de fora, ficou sem a visão de dentro. Não perca o que vem a seguir.</p>`,
        "📰 Quero ver o que perdi",
        `${APP_URL}`
      );
      break;
    case 15:
      subject = "O grupo continua ativo — veja o que você está perdendo";
      html = htmlBaseReengajamento(
        `🇧🇷 ${firstName}, está tudo bem?`,
        `<p>O Capitão Braga notou sua ausência. Já são 15 dias sem você no grupo.</p>
         <p>O Brasil continua precisando de patriotas atentos — e o grupo está cheio de novidades esperando por você.</p>`,
        "🇧🇷 Voltar ao grupo",
        `${APP_URL}`
      );
      break;
    case 20:
      subject = "Uma condição especial para você voltar (Elite Anual -10%)";
      html = htmlBaseReengajamento(
        `🎁 ${firstName}, preparamos algo especial para você`,
        `<p>Para quem esteve com a gente, liberamos uma condição exclusiva de retorno: <strong style="color:#ffd700">Elite Global Anual com 10% de desconto</strong> — de R$199 por <strong style="color:#ffd700">R$179,10/ano</strong>.</p>
         <p>8 análises por dia, Prof. Bernardo Cavalcanti exclusivo e Dossiê Semanal em PDF.</p>`,
        "🎁 Quero essa condição",
        `${APP_URL}/assinar?plano=elite&ciclo=anual&cupom=VOLTA10`
      );
      break;
    case 25:
      subject = "Atenção: sua vaga no grupo pode ser liberada";
      html = htmlBaseReengajamento(
        `⚠️ ${firstName}, sua vaga pode ser liberada em breve`,
        `<p>Para dar espaço a novos membros, vagas de quem está inativo há muito tempo podem ser realocadas.</p>
         <p>Ainda dá tempo: garanta o <strong style="color:#ffd700">Elite Global Anual com 15% de desconto</strong> — de R$199 por <strong style="color:#ffd700">R$169,15/ano</strong>.</p>`,
        "⚠️ Garantir minha vaga",
        `${APP_URL}/assinar?plano=elite&ciclo=anual&cupom=VOLTA15`
      );
      break;
    case 30:
    default:
      subject = "Última chance antes de sairmos do seu radar";
      html = htmlBaseReengajamento(
        `🎁 ${firstName}, esta é a última mensagem que vou te enviar`,
        `<p>Sentimos sua falta de verdade. Esta é a última tentativa: <strong style="color:#ffd700">Elite Global Anual com 20% de desconto</strong> — de R$199 por apenas <strong style="color:#ffd700">R$159,20/ano</strong>.</p>
         <p>Depois desta mensagem, não vou mais incomodar.</p>`,
        "🎁 Aproveitar última chance",
        `${APP_URL}/assinar?plano=elite&ciclo=anual&cupom=VOLTA20`
      );
      break;
  }

  return enviarEmail(email, nome, subject, html);
}
