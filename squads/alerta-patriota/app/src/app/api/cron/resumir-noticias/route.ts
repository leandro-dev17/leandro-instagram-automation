/**
 * AGENTE BERNARDO RESUMIDOR
 * Usa Claude para reescrever notícias curadas no tom do Capitão Braga
 * (resumo_braga, usado pelos grupos básico/patriota/vip) e do
 * Prof. Bernardo Cavalcanti (resumo_cavalcanti, usado pelo grupo elite).
 * GET /api/cron/resumir-noticias
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const PROMPT_BRAGA = `Você é o Capitão Braga, ex-militar evangélico, analítico e contundente.
Crie um GANCHO forte na primeira linha que prenda a atenção imediatamente.
Em seguida escreva 4-6 linhas: fato + análise + o que isso significa para o Brasil.
Mostre o que está por trás, o que a mídia não conta.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label antes do gancho. Comece direto com o gancho forte.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com a linha: Deus, Pátria e Família — sempre.
Responda APENAS com o texto da mensagem, nada mais.`;

const PROMPT_CAVALCANTI = `Você é o Prof. Bernardo Cavalcanti, ex-professor da USP, consultor político global.
Escreva uma análise de 5-7 linhas com perspectiva conservadora e global sobre esta notícia brasileira.
Conecte ao cenário político mais amplo e, quando relevante, a movimentos como Milei, Trump, etc.
Use linguagem sofisticada mas acessível. Seja preciso e analítico, sem exagero emocional.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label. Comece direto com a análise.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com: Análise do Prof. Cavalcanti.
Responda APENAS com o texto da mensagem, nada mais.`;

interface Noticia {
  id: number;
  titulo: string;
  conteudo_original: string | null;
  url: string;
}

async function gerarResumo(titulo: string, conteudo: string, url: string, prompt: string): Promise<string> {
  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 450,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\nNOTÍCIA: "${titulo}"\n${conteudo ? `CONTEÚDO: ${conteudo}\n` : ""}FONTE: ${url}`,
      },
    ],
  });

  const textBlock = message.content.find((block) => block.type === "text");
  return textBlock && textBlock.type === "text" ? textBlock.text.trim() : "";
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  let processadas = 0;
  let erros = 0;

  try {
    const noticias = await sql<Noticia[]>`
      SELECT id, titulo, conteudo_original, url
      FROM noticias
      WHERE categoria = 'curada'
        AND resumo_braga IS NULL
        AND (global IS NULL OR global = false)
        AND created_at >= NOW() - INTERVAL '8 hours'
      ORDER BY created_at DESC
      LIMIT 10
    `;

    if (noticias.length === 0) {
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
        VALUES ('bernardo-resumidor', 'resumir_noticias', 'sucesso',
          ${JSON.stringify({ processadas: 0, erros: 0, motivo: "sem noticias curadas pendentes" })},
          ${Date.now() - inicio})
      `;
      return NextResponse.json({ ok: true, processadas: 0, erros: 0, motivo: "sem notícias curadas pendentes" });
    }

    for (const noticia of noticias) {
      try {
        const conteudo = noticia.conteudo_original || "";
        const [resumoBraga, resumoCavalcanti] = await Promise.all([
          gerarResumo(noticia.titulo, conteudo, noticia.url, PROMPT_BRAGA),
          gerarResumo(noticia.titulo, conteudo, noticia.url, PROMPT_CAVALCANTI),
        ]);

        if (!resumoBraga || !resumoCavalcanti) {
          erros++;
          continue;
        }

        await sql`
          UPDATE noticias
          SET resumo_braga = ${resumoBraga}, resumo_cavalcanti = ${resumoCavalcanti}
          WHERE id = ${noticia.id}
        `;

        processadas++;
      } catch {
        erros++;
      }
    }

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('bernardo-resumidor', 'resumir_noticias', ${erros === 0 ? "sucesso" : "aviso"},
        ${JSON.stringify({ processadas, erros })}, ${duracao})
    `;

    return NextResponse.json({ ok: true, processadas, erros });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Bernardo Resumidor", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('bernardo-resumidor', 'resumir_noticias', 'erro', ${JSON.stringify({ erro: String(err) })}, ${Date.now() - inicio})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
