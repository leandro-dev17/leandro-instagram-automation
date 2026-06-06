/**
 * AGENTE BERNARDO RESUMIDOR
 * Usa Claude para reescrever notícias no tom do Capitão Braga (3 versões).
 * Versão básica: só resumo | Patriota: + comentário | VIP: + gancho urgente
 * GET /api/cron/resumir-noticias
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// FIX 1 & 2: Prompts corrigidos — formatação WhatsApp (*negrito*), sem markdown de título, sem cabeçalho separado
// REGRAS COMUNS: usar apenas *texto* para negrito (NÃO **texto**), nunca usar # ou ## headings

const PROMPT_BRAGA_BASICO = `Você é o Capitão Braga, ex-militar evangélico, direto e patriota.
Reescreva esta notícia em 3-4 linhas no ponto de vista conservador.
Seja direto e use linguagem simples que o brasileiro comum entende.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label no início. Comece direto com o conteúdo.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com a linha: Deus, Pátria e Família — sempre.
Responda APENAS com o texto da mensagem, nada mais.`;

const PROMPT_BRAGA_PATRIOTA = `Você é o Capitão Braga, ex-militar evangélico, direto e indignado.
Reescreva esta notícia em 4-6 linhas: primeiro o fato, depois seu comentário apaixonado.
Conecte ao impacto na família brasileira.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label no início. Comece direto com o conteúdo.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com a linha: Deus, Pátria e Família — sempre.
Responda APENAS com o texto da mensagem, nada mais.`;

const PROMPT_BRAGA_VIP = `Você é o Capitão Braga, ex-militar evangélico, analítico e contundente.
Crie um GANCHO forte na primeira linha que prenda a atenção imediatamente.
Em seguida escreva 5-7 linhas: fato + análise profunda + o que isso significa para o Brasil.
Mostre o que está por trás, o que a mídia não conta.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label antes do gancho. Comece direto com o gancho forte.
NÃO copie o texto original — crie conteúdo próprio.
Termine SEMPRE com a linha: Deus, Pátria e Família — sempre.
Responda APENAS com o texto da mensagem, nada mais.`;

// Prof. Cavalcanti para o grupo Elite
const PROMPT_CAVALCANTI_ELITE = `Você é o Prof. Bernardo Cavalcanti, ex-professor da USP, consultor político global.
Escreva uma análise de 5-7 linhas com perspectiva conservadora e global.
Conecte ao cenário político mais amplo e, quando relevante, a movimentos como Milei, Trump, etc.
Use linguagem sofisticada mas acessível. Seja preciso e analítico, sem exagero emocional.
NÃO use markdown de título (sem # ou ##). NÃO use ** — use apenas * para negrito se necessário.
NÃO adicione cabeçalho ou label no início. Comece direto com a análise.
NÃO copie o texto original — crie análise própria.
Termine SEMPRE com a linha: O mundo muda para quem enxerga antes.
Responda APENAS com o texto da mensagem, nada mais.`;

async function gerarResumo(titulo: string, url: string, prompt: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `${prompt}\n\nNOTÍCIA: "${titulo}"\nFONTE: ${url}`,
    }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  let processadas = 0;
  let erros = 0;

  try {
    // Busca notícias curadas sem resumo ainda (prioridade para 'curada', depois qualquer nova)
    const pendentes = await sql`
      SELECT id, titulo, url
      FROM noticias
      WHERE resumo_braga IS NULL
        AND (global IS NULL OR global = false)
        AND created_at >= NOW() - INTERVAL '10 hours'
      ORDER BY
        CASE WHEN categoria = 'curada' THEN 0 ELSE 1 END,
        created_at DESC
      LIMIT 5
    `;

    for (const noticia of pendentes) {
      try {
        // Gera 4 versões em paralelo: 3 do Capitão Braga + 1 do Prof. Cavalcanti (para o Elite)
        const [basico, patriota, vip, cavalcanti] = await Promise.all([
          gerarResumo(noticia.titulo, noticia.url, PROMPT_BRAGA_BASICO),
          gerarResumo(noticia.titulo, noticia.url, PROMPT_BRAGA_PATRIOTA),
          gerarResumo(noticia.titulo, noticia.url, PROMPT_BRAGA_VIP),
          gerarResumo(noticia.titulo, noticia.url, PROMPT_CAVALCANTI_ELITE),
        ]);

        await sql`
          UPDATE noticias
          SET resumo_braga = ${vip},
              resumo_cavalcanti = ${cavalcanti},
              categoria = COALESCE(NULLIF(categoria, 'curada'), categoria)
          WHERE id = ${noticia.id}
        `;

        // Salva versões separadas em posts_whatsapp como rascunho
        const grupoRows = await sql`SELECT id, plano FROM grupos_whatsapp WHERE ativo = true`;

        for (const grupo of grupoRows) {
          const conteudo = grupo.plano === "basico" ? basico
            : grupo.plano === "patriota" ? patriota
            : grupo.plano === "elite" ? cavalcanti
            : vip;

          await sql`
            INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status)
            VALUES (${grupo.id}, ${noticia.id}, ${conteudo}, 'noticia', 'rascunho')
            ON CONFLICT DO NOTHING
          `;
        }

        processadas++;
      } catch { erros++; }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('bernardo-resumidor', 'resumir_noticias', 'sucesso',
        ${JSON.stringify({ processadas, erros })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, processadas, erros });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Bernardo Resumidor", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
