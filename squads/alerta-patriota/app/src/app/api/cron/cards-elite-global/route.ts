/**
 * ROTA ELITE GLOBAL INTERNACIONAL
 * GET /api/cron/cards-elite-global
 *
 * Consultada pelo script whatsapp-cards.cjs nos horários premium (10h / 16h / 22h).
 * Fluxo:
 *   1. Busca próxima notícia global pendente para o Elite.
 *   2. Se encontrar → marca como postada_elite = true e retorna os dados.
 *   3. Se não encontrar → dispara coletar-noticias-global e resumir-noticias-global,
 *      então tenta buscar novamente (uma vez).
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const BASE_URL = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : "http://localhost:3000";

async function buscarProximaGlobal() {
  const rows = await sql`
    SELECT id, titulo, fonte, resumo_cavalcanti AS resumo, urgente, created_at
    FROM noticias
    WHERE global = true
      AND postada_elite = false
      AND resumo_cavalcanti IS NOT NULL
    ORDER BY urgente DESC, created_at ASC
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function dispararAgente(rota: string, secret: string) {
  try {
    const url = `${BASE_URL}${rota}`;
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(30_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }
  const secret = req.headers.get("authorization") ?? "";
  try {

    // Tentativa 1 — busca notícia já pronta
    let noticia = await buscarProximaGlobal();

    if (!noticia) {
      // Dispara coleta + resumo e tenta novamente uma vez
      await dispararAgente("/api/cron/coletar-noticias-global", secret);
      await dispararAgente("/api/cron/resumir-noticias-global", secret);

      // Aguarda processamento assíncrono
      await new Promise(r => setTimeout(r, 8_000));

      noticia = await buscarProximaGlobal();
    }

    if (!noticia) {
      return NextResponse.json({
        ok: false,
        motivo: "Nenhuma notícia global disponível. Agentes de coleta/resumo acionados.",
      });
    }

    // Marca como postada antes de retornar (idempotência: só uma execução publica)
    await sql`
      UPDATE noticias
      SET postada_elite = true
      WHERE id = ${noticia.id}
    `;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES (
        'cards-elite-global',
        'publicar_elite',
        'sucesso',
        ${JSON.stringify({ noticia_id: noticia.id, titulo: noticia.titulo })}::jsonb
      )
    `;

    return NextResponse.json({
      ok: true,
      noticia_id: noticia.id,
      titulo: noticia.titulo,
      fonte: noticia.fonte,
      resumo: noticia.resumo,
      urgente: noticia.urgente,
    });
  } catch (err) {
    console.error("[cards-elite-global]", err);
    await alertarTelegram("🔴", "Falha Cards Elite Global", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('cards-elite-global', 'publicar_elite', 'erro', ${JSON.stringify({ erro: String(err) })}::jsonb)
    `.catch(() => {});
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
