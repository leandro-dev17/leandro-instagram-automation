/**
 * AGENTE CAVALCANTI RESUMIDOR GLOBAL
 * Gera resumo no tom do Prof. Bernardo Cavalcanti para notícias internacionais.
 * Traduz quando necessário e conecta ao cenário conservador global.
 * GET /api/cron/resumir-noticias-global
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { PROMPT_CAVALCANTI_GLOBAL } from "@/lib/personas";
import { gerarTexto } from "@/lib/ai";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

// Acima deste número de falhas, a notícia para de ser reprocessada (e gasta IA à toa) e
// gera um alerta único — antes disso, uma falha simplesmente resetava o resumo pra NULL e
// a notícia voltava pro lote pendente até 10h depois, indefinidamente, sem nunca avisar ninguém.
const MAX_TENTATIVAS_RESUMO = 3;

// Busca og:description na página quando o RSS não trouxe conteúdo (ou trouxe pouco) —
// mesmo padrão usado em resumir-noticias, aplicado só às ~6 notícias globais pendentes.
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

async function gerarResumoGlobal(titulo: string, conteudo: string, url: string): Promise<string> {
  return gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "cavalcanti-resumidor",
    max_tokens: 450,
    messages: [{
      role: "user",
      content: `${PROMPT_CAVALCANTI_GLOBAL}\n\nNOTÍCIA: "${titulo}"\n${conteudo ? `CONTEÚDO: ${conteudo}\n` : ""}FONTE: ${url}`,
    }],
  });
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  let processadas = 0;
  let erros = 0;

  try {
    // Garante a coluna de tentativas (idempotente, mesmo padrão das colunas de card em gerar-card.ts)
    await sql`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS tentativas_resumo_cavalcanti INT DEFAULT 0`.catch(() => {});

    // Busca notícias globais sem resumo, exceto as que já esgotaram as tentativas
    const pendentes = await sql`
      SELECT id, titulo, url, conteudo_original, tentativas_resumo_cavalcanti
      FROM noticias
      WHERE global = true
      AND resumo_cavalcanti IS NULL
      AND tentativas_resumo_cavalcanti < ${MAX_TENTATIVAS_RESUMO}
      AND created_at >= NOW() - INTERVAL '10 hours'
      ORDER BY created_at DESC
      LIMIT 6
    `;

    for (const n of pendentes) {
      try {
        // Reserva a notícia antes de chamar a IA — evita gerar e pagar pela IA duas vezes
        // se houver execução concorrente (mesmo padrão usado em resumir-noticias).
        const claim = await sql`
          UPDATE noticias SET resumo_cavalcanti = '__PROCESSANDO__'
          WHERE id = ${n.id} AND resumo_cavalcanti IS NULL
          RETURNING id
        `;
        if (claim.length === 0) continue; // outra execução já está processando

        let conteudo = (n.conteudo_original as string | null) || "";
        if (conteudo.length < 200) {
          const fallback = await buscarConteudoFallback(n.url);
          if (fallback.length > conteudo.length) conteudo = fallback;
        }

        const resumo = await gerarResumoGlobal(n.titulo, conteudo, n.url);
        if (!resumo) {
          const novasTentativas = n.tentativas_resumo_cavalcanti + 1;
          await sql`UPDATE noticias SET resumo_cavalcanti = NULL, tentativas_resumo_cavalcanti = ${novasTentativas} WHERE id = ${n.id}`;
          if (novasTentativas >= MAX_TENTATIVAS_RESUMO) {
            await alertarTelegram("🟡", "Resumo Cavalcanti global abandonado após falhas repetidas", `Notícia id ${n.id} ("${n.titulo}") falhou ${novasTentativas}x ao gerar resumo — parando de reprocessar para não gastar IA à toa.`).catch(() => {});
          }
          erros++;
          continue;
        }

        await sql`
          UPDATE noticias
          SET resumo_cavalcanti = ${resumo}
          WHERE id = ${n.id}
        `;

        // Salva rascunho para o grupo Elite
        const grupoElite = await sql`SELECT id FROM grupos_whatsapp WHERE plano = 'elite' LIMIT 1`;
        if (grupoElite.length > 0) {
          const msg = `📊 *ANÁLISE INTERNACIONAL — Prof. Bernardo Cavalcanti*\n\n${resumo}`;
          await sql`
            INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status)
            VALUES (${grupoElite[0].id}, ${n.id}, ${msg}, 'noticia', 'rascunho')
            ON CONFLICT (grupo_id, noticia_id, tipo) WHERE status = 'rascunho' DO NOTHING
          `;
        }

        processadas++;
      } catch {
        await sql`UPDATE noticias SET resumo_cavalcanti = NULL WHERE id = ${n.id} AND resumo_cavalcanti = '__PROCESSANDO__'`.catch(() => {});
        erros++;
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('cavalcanti-resumidor', 'resumir_global', 'sucesso',
        ${JSON.stringify({ processadas, erros })}, ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, processadas, erros });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Cavalcanti Resumidor Global", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
