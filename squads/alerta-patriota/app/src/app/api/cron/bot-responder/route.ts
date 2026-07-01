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
import { enviarMensagemGrupo } from "@/lib/whatsapp";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

async function gerarRespostaBraga(pergunta: string): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "bot-responder",
    max_tokens: 250,
    messages: [{ role: "user", content: `Você é o Capitão Braga, ex-militar evangélico e patriota.
Um membro do grupo VIP enviou esta mensagem:
<mensagem>
${pergunta}
</mensagem>

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
Um membro do Elite Global enviou esta mensagem:
<mensagem>
${pergunta}
</mensagem>

Responda em 4-5 linhas de forma analítica e sofisticada.
Conecte ao cenário mais amplo quando pertinente.
Se for um link de notícia, faça uma análise rápida e perspicaz.
Termine com: "O mundo muda para quem enxerga antes."
Responda APENAS com o texto.` }],
  });
  return texto;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Reserva mensagens pendentes de forma atômica (claim via FOR UPDATE SKIP LOCKED) —
    // evita que duas execuções concorrentes (ex.: triggers duplicados do GitHub Actions)
    // peguem o mesmo item e respondam duas vezes no grupo.
    const pendentes = await sql`
      WITH proximos AS (
        SELECT id FROM whatsapp_fila
        WHERE tipo IN ('pergunta_vip', 'pergunta_elite')
        AND processado_em IS NULL
        AND agendado_para <= NOW()
        ORDER BY agendado_para ASC
        LIMIT 10
        FOR UPDATE SKIP LOCKED
      )
      UPDATE whatsapp_fila SET processado_em = NOW()
      WHERE id IN (SELECT id FROM proximos)
      RETURNING id, usuario_id, tipo, mensagem
    `;

    let respondidas = 0;

    for (const item of pendentes) {
      const ehElite = item.tipo === "pergunta_elite";
      const plano = ehElite ? "elite" : "vip";

      const resposta = ehElite
        ? await gerarRespostaCavalcanti(item.mensagem)
        : await gerarRespostaBraga(item.mensagem);

      if (!resposta) {
        // Geração falhou — libera o item (já reservado pelo claim atômico acima) para nova tentativa
        await sql`UPDATE whatsapp_fila SET processado_em = NULL WHERE id = ${item.id}`;
        continue;
      }

      const prefixo = ehElite
        ? "📊 *Prof. Cavalcanti responde:*\n\n"
        : "🎖️ *Capitão Braga responde:*\n\n";

      const ok = await enviarMensagemGrupo(plano, prefixo + resposta);

      if (ok) {
        respondidas++;
      } else {
        // Envio falhou — libera o item para a próxima execução tentar de novo
        await sql`UPDATE whatsapp_fila SET processado_em = NULL WHERE id = ${item.id}`;
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
