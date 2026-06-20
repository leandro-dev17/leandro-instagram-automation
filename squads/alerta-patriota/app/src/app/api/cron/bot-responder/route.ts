/**
 * AGENTE BOT RESPONDER
 * Processa fila de mensagens pendentes dos grupos VIP e Elite
 * e responde com a persona correta (Capitão Braga ou Prof. Cavalcanti).
 * Roda a cada 5 minutos via GitHub Actions.
 * GET /api/cron/bot-responder
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { gerarTexto } from "@/lib/ai";
import { alertarTelegram } from "@/lib/telegram";
const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA;

async function gerarRespostaBraga(pergunta: string): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "bot-responder",
    max_tokens: 250,
    messages: [{ role: "user", content: `Você é o Capitão Braga, ex-militar evangélico e patriota.
Um membro do grupo VIP te fez esta pergunta/comentário: "${pergunta}"

Responda em 3-4 linhas de forma direta, patriótica e no tom conservador.
Se for uma pergunta sobre política, dê sua opinião sincera.
Se for um link de notícia, comente rapidamente o que acha.
Termine com: "Deus, Pátria e Família — sempre."
Responda APENAS com o texto.` }],
  });
  return texto;
}

async function gerarRespostaCavalcanti(pergunta: string): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "bot-responder",
    max_tokens: 300,
    messages: [{ role: "user", content: `Você é o Prof. Bernardo Cavalcanti, analista político global.
Um membro do Elite Global te fez esta pergunta/comentário: "${pergunta}"

Responda em 4-5 linhas de forma analítica e sofisticada.
Conecte ao cenário mais amplo quando pertinente.
Se for um link de notícia, faça uma análise rápida e perspicaz.
Termine com: "O mundo muda para quem enxerga antes."
Responda APENAS com o texto.` }],
  });
  return texto;
}

async function enviarRespostaGrupo(groupJid: string, texto: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY || !EVO_INST) return false;
  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({ number: groupJid, textMessage: { text: texto } }),
    });
    return res.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Busca mensagens pendentes na fila de respostas
    const pendentes = await sql`
      SELECT id, usuario_id, tipo, mensagem
      FROM whatsapp_fila
      WHERE tipo IN ('pergunta_vip', 'pergunta_elite')
      AND processado_em IS NULL
      AND agendado_para <= NOW()
      ORDER BY agendado_para ASC
      LIMIT 10
    `;

    let respondidas = 0;

    for (const item of pendentes) {
      const ehElite = item.tipo === "pergunta_elite";
      const groupJid = ehElite
        ? process.env.WPP_GROUP_ELITE
        : process.env.WPP_GROUP_VIP;

      if (!groupJid) continue;

      const resposta = ehElite
        ? await gerarRespostaCavalcanti(item.mensagem)
        : await gerarRespostaBraga(item.mensagem);

      if (!resposta) continue;

      const prefixo = ehElite
        ? "📊 *Prof. Cavalcanti responde:*\n\n"
        : "🎖️ *Capitão Braga responde:*\n\n";

      const ok = await enviarRespostaGrupo(groupJid, prefixo + resposta);

      if (ok) {
        await sql`UPDATE whatsapp_fila SET processado_em = NOW() WHERE id = ${item.id}`;
        respondidas++;
      }

      // Pausa entre respostas para não parecer bot
      await new Promise(r => setTimeout(r, 3000));
    }

    if (respondidas > 0) {
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('bot-responder', 'responder_fila', 'sucesso',
          ${JSON.stringify({ respondidas, pendentes: pendentes.length })})
      `.catch(() => {});
    }

    return NextResponse.json({ ok: true, respondidas });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Bot Responder", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('bot-responder', 'responder_fila', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
