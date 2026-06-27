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
    // Busca notícias globais sem resumo
    const pendentes = await sql`
      SELECT id, titulo, url, conteudo_original
      FROM noticias
      WHERE global = true
      AND resumo_cavalcanti IS NULL
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
          await sql`UPDATE noticias SET resumo_cavalcanti = NULL WHERE id = ${n.id}`;
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
            ON CONFLICT DO NOTHING
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
