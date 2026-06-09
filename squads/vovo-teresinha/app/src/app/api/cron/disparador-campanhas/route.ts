import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const BREVO_API_KEY = process.env.BREVO_API_KEY;
const EVOLUTION_URL = process.env.EVOLUTION_API_URL;
const EVOLUTION_KEY = process.env.EVOLUTION_API_KEY;
const EVOLUTION_INSTANCE = process.env.EVOLUTION_INSTANCE || "vovoapp";

async function enviarEmailBrevo(email: string, nome: string, tipo: "reativacao" | "recuperacao") {
  if (!BREVO_API_KEY) return false;

  const templates: Record<typeof tipo, { assunto: string; html: string }> = {
    reativacao: {
      assunto: "Sentimos sua falta, " + nome.split(" ")[0] + "! 👵❤️",
      html: `<p>Olá ${nome.split(" ")[0]},</p>
<p>A Vovó Teresinha está com saudades! Você cancelou sua assinatura recentemente.</p>
<p>Que tal voltar? Todas as suas receitas favoritas ainda estão aqui esperando por você.</p>
<p><a href="https://receitinhas-vovo-teresinha.vercel.app/assinar">Reativar minha assinatura</a></p>
<p>Com carinho,<br>Vovó Teresinha 👵</p>`,
    },
    recuperacao: {
      assunto: "Vovó Teresinha tem receitas especiais para você! 🍲",
      html: `<p>Olá ${nome.split(" ")[0]},</p>
<p>Você se cadastrou nas Receitinhas da Vovó Teresinha mas ainda não descobriu todas as nossas receitas exclusivas!</p>
<p>Assine agora e tenha acesso a mais de 500 receitas saudáveis e deliciosas.</p>
<p><a href="https://receitinhas-vovo-teresinha.vercel.app/assinar">Quero conhecer as receitas premium</a></p>
<p>Com carinho,<br>Vovó Teresinha 👵</p>`,
    },
  };

  const tpl = templates[tipo];
  const res = await fetch("https://api.brevo.com/v3/smtp/email", {
    method: "POST",
    headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      sender: { name: "Vovó Teresinha", email: "noreply@receitinhas.com" },
      to: [{ email, name: nome }],
      subject: tpl.assunto,
      htmlContent: tpl.html,
    }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

async function enviarWhatsApp(telefone: string, nome: string, tipo: "reativacao" | "recuperacao") {
  if (!EVOLUTION_URL || !EVOLUTION_KEY || !telefone) return false;

  const mensagens: Record<typeof tipo, string> = {
    reativacao: `Olá ${nome.split(" ")[0]}! 👵❤️\n\nA Vovó Teresinha está com saudades!\n\nQue tal voltar? Todas as suas receitas favoritas ainda estão aqui esperando por você.\n\n👉 https://receitinhas-vovo-teresinha.vercel.app/assinar`,
    recuperacao: `Olá ${nome.split(" ")[0]}! 🍲\n\nA Vovó Teresinha tem receitas deliciosas esperando por você!\n\nConheça nossos planos premium e acesse mais de 500 receitas exclusivas.\n\n👉 https://receitinhas-vovo-teresinha.vercel.app/assinar`,
  };

  const res = await fetch(`${EVOLUTION_URL}/message/sendText/${EVOLUTION_INSTANCE}`, {
    method: "POST",
    headers: { apikey: EVOLUTION_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({ number: telefone, text: mensagens[tipo] }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const resultados = { email_ok: 0, email_falha: 0, wpp_ok: 0, wpp_falha: 0, sem_canal: 0 };

  try {
    // Pega contatos marcados pelo cacador-desistentes mas ainda não disparados
    const pendentes = await sql`
      SELECT ac.chave, ac.valor,
             u.email, u.nome, u.whatsapp,
             a.status as status_assinatura
      FROM app_configuracoes ac
      JOIN usuarios u ON u.id = CAST(REPLACE(ac.chave, 'desistente_contatado_', '') AS INTEGER)
      LEFT JOIN assinaturas a ON a.usuario_id = u.id AND a.status IN ('cancelada', 'paused')
      WHERE ac.chave LIKE 'desistente_contatado_%'
        AND ac.valor NOT LIKE '%disparado%'
      LIMIT 20
    `;

    // Pega contatos da campanha de recuperação (free sem assinar)
    const recuperacao = await sql`
      SELECT ac.chave, u.email, u.nome, u.whatsapp
      FROM app_configuracoes ac
      JOIN usuarios u ON u.id = CAST(REPLACE(ac.chave, 'campanha_recuperacao_', '') AS INTEGER)
      WHERE ac.chave LIKE 'campanha_recuperacao_%'
        AND ac.valor NOT LIKE '%disparado%'
      LIMIT 10
    `;

    // Dispara para reativação
    for (const contato of pendentes) {
      const tipo = "reativacao" as const;
      let disparou = false;

      if (BREVO_API_KEY && contato.email) {
        const ok = await enviarEmailBrevo(contato.email, contato.nome, tipo);
        if (ok) { resultados.email_ok++; disparou = true; }
        else resultados.email_falha++;
      }

      if (EVOLUTION_URL && contato.whatsapp) {
        const ok = await enviarWhatsApp(contato.whatsapp, contato.nome, tipo);
        if (ok) { resultados.wpp_ok++; disparou = true; }
        else resultados.wpp_falha++;
      }

      if (!disparou) resultados.sem_canal++;

      // Marca como disparado
      await sql`
        UPDATE app_configuracoes SET valor = 'disparado_' || NOW()::TEXT
        WHERE chave = ${contato.chave}
      `;
    }

    // Dispara para recuperação
    for (const contato of recuperacao) {
      const tipo = "recuperacao" as const;
      if (BREVO_API_KEY && contato.email) {
        const ok = await enviarEmailBrevo(contato.email, contato.nome, tipo);
        if (ok) resultados.email_ok++; else resultados.email_falha++;
      }
      if (EVOLUTION_URL && contato.whatsapp) {
        const ok = await enviarWhatsApp(contato.whatsapp, contato.nome, tipo);
        if (ok) resultados.wpp_ok++; else resultados.wpp_falha++;
      }
      await sql`
        UPDATE app_configuracoes SET valor = 'disparado_' || NOW()::TEXT
        WHERE chave = ${contato.chave}
      `;
    }

    const total = pendentes.length + recuperacao.length;
    if (total > 0) {
      const canaisAtivos = [BREVO_API_KEY ? "Email" : null, EVOLUTION_URL ? "WhatsApp" : null].filter(Boolean).join(" + ") || "Nenhum canal configurado";
      await enviarTelegram(
        `📨 <b>Disparador de Campanhas</b>\n\n` +
        `Canais: ${canaisAtivos}\n` +
        `Reativações: ${pendentes.length} | Recuperações: ${recuperacao.length}\n` +
        `✅ Emails: ${resultados.email_ok} | ✅ WPP: ${resultados.wpp_ok}\n` +
        `❌ Falhas email: ${resultados.email_falha} | ❌ Falhas WPP: ${resultados.wpp_falha}\n` +
        (resultados.sem_canal > 0 ? `⚠️ ${resultados.sem_canal} sem canal disponível` : "")
      );
    }

    await resolverFalhas("disparador-campanhas");
    return NextResponse.json({ ok: true, total_disparado: total, resultados });
  } catch (err) {
    await reportarFalha("disparador-campanhas", String(err));
    return NextResponse.json({ erro: "Erro no disparador" }, { status: 500 });
  }
}
