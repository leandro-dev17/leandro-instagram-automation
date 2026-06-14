/**
 * AGENTE COMENTÁRIOS FACEBOOK — Capitão Braga responde tudo
 * Monitora comentários novos na página e responde no tom patriótico com CTA.
 * GET /api/cron/facebook-comentarios
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { buscarComentariosNaoRespondidos, responderComentario } from "@/lib/facebook";
import { gerarTexto } from "@/lib/ai";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

async function gerarRespostaComentario(autor: string, comentario: string): Promise<string> {
  const texto = comentario.toLowerCase();

  // Respostas rápidas para padrões comuns (sem gastar Claude)
  if (texto.includes("como") && (texto.includes("entrar") || texto.includes("assinar") || texto.includes("grupo"))) {
    return `Olá, ${autor}! 🇧🇷 Para entrar no grupo acesse: ${APP_URL}/assinar\n\nDeus, Pátria e Família — sempre. — Capitão Braga`;
  }
  if (texto.includes("preço") || texto.includes("valor") || texto.includes("quanto")) {
    return `${autor}, temos planos a partir de R$9,90/mês! 🇧🇷\n\nVeja todas as opções: ${APP_URL}/assinar\n\n— Capitão Braga`;
  }

  // Resposta com Claude para comentários complexos
  const resposta = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages: [{ role: "user", content: `Você é o Capitão Braga em uma página do Facebook. Responda este comentário de forma breve (2-3 linhas), no tom patriótico e conservador:

Autor: ${autor}
Comentário: "${comentario}"

Se for elogio: agradeça e convide para o grupo.
Se for dúvida: responda e direcione para ${APP_URL}/assinar
Se for crítica/ataque: responda com firmeza mas educação.

Termine sempre com "— Capitão Braga"
Responda APENAS com o texto da resposta.` }],
  });
  if (!resposta.includes(APP_URL) && (comentario.toLowerCase().includes("entrar") || comentario.toLowerCase().includes("grupo"))) {
    return `${resposta}\n\nPara entrar: ${APP_URL}/assinar`;
  }
  return resposta;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const comentarios = await buscarComentariosNaoRespondidos();
    if (!comentarios.length) return NextResponse.json({ ok: true, respondidos: 0, motivo: "sem comentários novos" });

    let respondidos = 0;

    for (const c of comentarios) {
      if (!c.mensagem?.trim()) continue;

      // Verifica se já respondemos este comentário
      const jaRespondeu = await sql`
        SELECT id FROM agentes_log
        WHERE agente = 'facebook-comentarios' AND detalhes->>'comentarioId' = ${c.id}
        LIMIT 1
      `;
      if (jaRespondeu.length > 0) continue;

      const resposta = await gerarRespostaComentario(c.autor, c.mensagem);
      if (!resposta) continue;

      const ok = await responderComentario(c.id, resposta);

      if (ok) {
        await sql`
          INSERT INTO agentes_log (agente, acao, status, detalhes)
          VALUES ('facebook-comentarios', 'responder_comentario', 'sucesso',
            ${JSON.stringify({ comentarioId: c.id, autor: c.autor })})
        `;
        respondidos++;
      }

      // Pausa entre respostas para não parecer bot
      await new Promise(r => setTimeout(r, 3000));
    }

    return NextResponse.json({ ok: true, encontrados: comentarios.length, respondidos });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Comentários Facebook", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('facebook-comentarios', 'responder_comentario', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
