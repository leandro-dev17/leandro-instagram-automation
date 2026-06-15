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

async function gerarResumoGlobal(titulo: string, url: string): Promise<string> {
  return gerarTexto({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 450,
    messages: [{ role: "user", content: `${PROMPT_CAVALCANTI_GLOBAL}\n\nNOTÍCIA: "${titulo}"\nFONTE: ${url}` }],
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
      SELECT id, titulo, url
      FROM noticias
      WHERE global = true
      AND resumo_cavalcanti IS NULL
      AND created_at >= NOW() - INTERVAL '10 hours'
      ORDER BY created_at DESC
      LIMIT 6
    `;

    for (const n of pendentes) {
      try {
        const resumo = await gerarResumoGlobal(n.titulo, n.url);
        if (!resumo) { erros++; continue; }

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
      } catch { erros++; }
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
