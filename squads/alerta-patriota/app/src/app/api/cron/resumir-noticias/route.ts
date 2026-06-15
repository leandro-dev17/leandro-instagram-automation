/**
 * AGENTE BERNARDO RESUMIDOR
 * Usa Claude para reescrever notícias curadas no tom do Capitão Braga
 * (resumo_braga, usado pelo grupo vip) e do
 * Prof. Bernardo Cavalcanti (resumo_cavalcanti, usado pelo grupo elite).
 * GET /api/cron/resumir-noticias
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { PROMPT_BRAGA, PROMPT_CAVALCANTI } from "@/lib/personas";
import { gerarTexto } from "@/lib/ai";

interface Noticia {
  id: number;
  titulo: string;
  conteudo_original: string | null;
  url: string;
}

async function gerarResumo(titulo: string, conteudo: string, url: string, prompt: string): Promise<string> {
  return gerarTexto({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 450,
    messages: [
      {
        role: "user",
        content: `${prompt}\n\nNOTÍCIA: "${titulo}"\n${conteudo ? `CONTEÚDO: ${conteudo}\n` : ""}FONTE: ${url}`,
      },
    ],
  });
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
      LIMIT 4
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
