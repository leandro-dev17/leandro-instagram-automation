import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { PROMPT_BRAGA, PROMPT_CAVALCANTI, obterPromptCustomizado } from "@/lib/personas";
import { gerarTexto } from "@/lib/ai";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

interface Noticia {
  id: number;
  titulo: string;
  conteudo_original: string | null;
  url: string;
  resumo_braga: string | null;
  resumo_cavalcanti: string | null;
  tentativas_resumo_braga: number;
  tentativas_resumo_cavalcanti: number;
}

// Acima deste número de falhas, a notícia para de ser reprocessada (e gasta IA à toa) e
// gera um alerta único — antes disso, uma falha simplesmente resetava o resumo pra NULL e
// a notícia voltava pro lote pendente indefinidamente, sem nunca avisar ninguém.
const MAX_TENTATIVAS_RESUMO = 3;

// Quando o RSS não trouxe descrição (ou trouxe algo curto demais p/ a IA ter
// substância real pra resumir), busca o og:description direto na página da notícia —
// só roda para as ~100 notícias curadas pendentes, não no lote inteiro da coleta,
// pra não arriscar timeout do cron de coleta.
async function buscarConteudoFallback(url: string): Promise<string> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return "";
    const html = await res.text();
    const og = html.match(/<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)["']/i)
      || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:description["']/i);
    if (!og) return "";
    return og[1]
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "")
      .replace(/&quot;/g, '"').replace(/&#039;/g, "'")
      .trim().slice(0, 2000);
  } catch {
    return "";
  }
}

async function gerarResumo(titulo: string, conteudo: string, url: string, prompt: string): Promise<string> {
  try {
    return await gerarTexto({
      model: "claude-haiku-4-5-20251001",
      agente: "bernardo-resumidor",
      max_tokens: 450,
      messages: [
        {
          role: "user",
          content: `${prompt}\n\nNOTÍCIA: "${titulo}"\n${conteudo ? `CONTEÚDO: ${conteudo}\n` : ""}FONTE: ${url}`,
        },
      ],
    });
  } catch (err) {
    console.error(err);
    throw err;
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  let processadas = 0;
  let erros = 0;
  let motivo = "";
  let noticiasDuplicadas = 0;

  try {
    // Garante as colunas de tentativas (idempotente, mesmo padrão das colunas de card em gerar-card.ts)
    await sql`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS tentativas_resumo_braga INT DEFAULT 0`.catch(() => {});
    await sql`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS tentativas_resumo_cavalcanti INT DEFAULT 0`.catch(() => {});

    const [promptBraga, promptCavalcanti] = await Promise.all([
      obterPromptCustomizado("braga_vip", PROMPT_BRAGA),
      obterPromptCustomizado("cavalcanti", PROMPT_CAVALCANTI),
    ]);

    const noticias = (await sql`
      SELECT id, titulo, conteudo_original, url, resumo_braga, resumo_cavalcanti, tentativas_resumo_braga, tentativas_resumo_cavalcanti
      FROM noticias
      WHERE categoria = 'curada'
        AND (global IS NULL OR global = false)
        AND ((resumo_braga IS NULL AND tentativas_resumo_braga < ${MAX_TENTATIVAS_RESUMO})
          OR (resumo_cavalcanti IS NULL AND tentativas_resumo_cavalcanti < ${MAX_TENTATIVAS_RESUMO}))
        AND created_at >= NOW() - INTERVAL '6 hours'
      ORDER BY created_at DESC
      LIMIT 100
    `) as unknown as Noticia[];

    if (noticias.length === 0) {
      motivo = "sem noticias curadas pendentes";
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
        VALUES ('bernardo-resumidor', 'resumir_noticias', 'sucesso',
          ${JSON.stringify({ processadas: 0, erros: 0, motivo: motivo })},
          ${Date.now() - inicio})
      `;
      return NextResponse.json({ ok: true, processadas: 0, erros: 0, motivo: motivo });
    }

    const noticiasJaProcessadas: { [id: number]: boolean } = {};

    for (const noticia of noticias) {
      if (noticiasJaProcessadas[noticia.id]) {
        noticiasDuplicadas++;
        continue;
      }

      noticiasJaProcessadas[noticia.id] = true;

      try {
        let conteudo = noticia.conteudo_original || "";
        if (conteudo.length < 200) {
          const fallback = await buscarConteudoFallback(noticia.url);
          if (fallback.length > conteudo.length) conteudo = fallback;
        }
        let resumoBraga: string | null = noticia.resumo_braga;
        let resumoCavalcanti: string | null = noticia.resumo_cavalcanti;

        // Reserva cada resumo de forma atômica antes de chamar a IA: o UPDATE com
        // WHERE ...IS NULL só afeta a linha se nenhuma outra execução concorrente
        // (ex.: workflow_dispatch manual rodando junto com o cron agendado) já a
        // tiver reservado — evita gerar e pagar pela IA duas vezes para a mesma notícia.
        if (!resumoBraga && noticia.tentativas_resumo_braga < MAX_TENTATIVAS_RESUMO) {
          const claim = await sql`
            UPDATE noticias SET resumo_braga = '__PROCESSANDO__'
            WHERE id = ${noticia.id} AND resumo_braga IS NULL
            RETURNING id
          `;
          if (claim.length > 0) {
            try {
              resumoBraga = await gerarResumo(noticia.titulo, conteudo, noticia.url, promptBraga);
              await sql`UPDATE noticias SET resumo_braga = ${resumoBraga} WHERE id = ${noticia.id}`;
            } catch (e) {
              const novasTentativas = noticia.tentativas_resumo_braga + 1;
              await sql`UPDATE noticias SET resumo_braga = NULL, tentativas_resumo_braga = ${novasTentativas} WHERE id = ${noticia.id}`;
              if (novasTentativas >= MAX_TENTATIVAS_RESUMO) {
                await alertarTelegram("🟡", "Resumo Braga abandonado após falhas repetidas", `Notícia id ${noticia.id} ("${noticia.titulo}") falhou ${novasTentativas}x ao gerar resumo Braga — parando de reprocessar para não gastar IA à toa.`).catch(() => {});
              }
              throw e;
            }
          } else {
            resumoBraga = null; // outra execução já está processando — pula nesta rodada
          }
        }

        if (!resumoCavalcanti && noticia.tentativas_resumo_cavalcanti < MAX_TENTATIVAS_RESUMO) {
          const claim = await sql`
            UPDATE noticias SET resumo_cavalcanti = '__PROCESSANDO__'
            WHERE id = ${noticia.id} AND resumo_cavalcanti IS NULL
            RETURNING id
          `;
          if (claim.length > 0) {
            try {
              resumoCavalcanti = await gerarResumo(noticia.titulo, conteudo, noticia.url, promptCavalcanti);
              await sql`UPDATE noticias SET resumo_cavalcanti = ${resumoCavalcanti} WHERE id = ${noticia.id}`;
            } catch (e) {
              const novasTentativas = noticia.tentativas_resumo_cavalcanti + 1;
              await sql`UPDATE noticias SET resumo_cavalcanti = NULL, tentativas_resumo_cavalcanti = ${novasTentativas} WHERE id = ${noticia.id}`;
              if (novasTentativas >= MAX_TENTATIVAS_RESUMO) {
                await alertarTelegram("🟡", "Resumo Cavalcanti abandonado após falhas repetidas", `Notícia id ${noticia.id} ("${noticia.titulo}") falhou ${novasTentativas}x ao gerar resumo Cavalcanti — parando de reprocessar para não gastar IA à toa.`).catch(() => {});
              }
              throw e;
            }
          } else {
            resumoCavalcanti = null;
          }
        }

        if (!resumoBraga || !resumoCavalcanti) {
          throw new Error('Resumo não gerado');
        }

        processadas++;
      } catch (err) {
        console.error(err);
        erros++;
      }
    }

    if (noticiasDuplicadas > 0) {
      await alertarTelegram("🟡", "Notícias duplicadas detectadas", `Foram detectadas ${noticiasDuplicadas} notícias duplicadas nas últimas 6 horas.`);
    }

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('bernardo-resumidor', 'resumir_noticias', ${erros === 0 ? "sucesso" : "aviso"},
        ${JSON.stringify({ processadas, erros, noticiasDuplicadas })}, ${duracao})
    `;

    return NextResponse.json({ ok: true, processadas, erros, noticiasDuplicadas });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Bernardo Resumidor", String(err));
    const duracao = Date.now() - inicio;
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('bernardo-resumidor', 'resumir_noticias', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}