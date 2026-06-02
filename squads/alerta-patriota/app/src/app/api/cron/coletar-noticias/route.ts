/**
 * AGENTE NETO NOTÍCIAS
 * Coleta notícias 3x/dia via RSS das principais fontes conservadoras brasileiras.
 * Executa às 6h, 12h e 18h (antes dos publicadores).
 * GET /api/cron/coletar-noticias
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

// Fontes RSS — portais conservadores e de política (sem entretenimento)
const FONTES_BR = [
  { nome: "Jovem Pan",        url: "https://jovempan.com.br/feed/",                        categoria: "politica" },
  { nome: "Revista Oeste",    url: "https://revistaoeste.com/feed/",                       categoria: "politica" },
  { nome: "Gazeta do Povo",   url: "https://www.gazetadopovo.com.br/rss/politica.xml",     categoria: "politica" },
  { nome: "O Antagonista",    url: "https://www.oantagonista.com/feed/",                   categoria: "politica" },
  { nome: "Veja Política",    url: "https://veja.abril.com.br/feed/politica/",             categoria: "politica" },
  { nome: "Terça Livre",      url: "https://tercalivre.com.br/feed/",                      categoria: "politica" },
  { nome: "CNN Brasil Pol.",  url: "https://www.cnnbrasil.com.br/politica/feed/",          categoria: "politica" },
];

// YouTube RSS dos canais dos principais deputados e figuras conservadoras
// Coletado direto na fonte — não depende de portais mencionarem o nome deles
const FONTES_YOUTUBE_DEPUTADOS = [
  { nome: "Nikolas Ferreira",  url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCcJiaqLbdHMZUKFABlqP2Kw" },
  { nome: "Eduardo Bolsonaro", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCiKLz6Bqm_BKnBRFWfXv_3Q" },
  { nome: "Marco Feliciano",   url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCf7LNrXhz2hOIHPbvYYLfbw" },
  { nome: "Damares Alves",     url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsLo154Krjwbt8ZoNiam149" },
  { nome: "Jovem Pan News",    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCvFBSKy7dUNvfMnAT_Rkwig" },
];

function extrairTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "s"));
  return m ? m[1].trim().replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#8217;/g, "'").replace(/&#8220;/g, '"').replace(/&#8221;/g, '"') : "";
}

function extrairLink(item: string): string {
  // Tenta <link> sem CDATA primeiro, depois <guid>
  const link = item.match(/<link>([^<]+)<\/link>/);
  if (link) return link[1].trim();
  const guid = item.match(/<guid[^>]*>([^<]+)<\/guid>/);
  return guid ? guid[1].trim() : "";
}

async function coletarRSS(fonte: typeof FONTES_BR[0]): Promise<Array<{ titulo: string; url: string; fonte: string; categoria: string }>> {
  try {
    const res = await fetch(fonte.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const itens: Array<{ titulo: string; url: string; fonte: string; categoria: string }> = [];

    // Divide por <item> ou <entry> (RSS e Atom)
    const regex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
    let match;
    let count = 0;

    while ((match = regex.exec(xml)) !== null && count < 8) {
      const bloco = match[1];
      const titulo = extrairTag(bloco, "title");
      const url = extrairLink(bloco);

      if (titulo && url && url.startsWith("http")) {
        itens.push({ titulo, url, fonte: fonte.nome, categoria: fonte.categoria });
        count++;
      }
    }

    return itens;
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  let coletadas = 0;
  let duplicatas = 0;
  let erros = 0;

  try {
    // Coleta portais + YouTube dos deputados em paralelo
    const todasFontes = [
      ...FONTES_BR,
      ...FONTES_YOUTUBE_DEPUTADOS.map(f => ({ ...f, categoria: "politica" })),
    ];

    for (const fonte of todasFontes) {
      const noticias = await coletarRSS(fonte);

      for (const n of noticias) {
        try {
          // Verifica se URL já existe
          const existe = await sql`SELECT id FROM noticias WHERE url = ${n.url} LIMIT 1`;
          if (existe.length > 0) { duplicatas++; continue; }

          await sql`
            INSERT INTO noticias (titulo, fonte, url, categoria, created_at)
            VALUES (${n.titulo}, ${n.fonte}, ${n.url}, ${n.categoria}, NOW())
          `;
          coletadas++;
        } catch { erros++; }
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('neto-noticias', 'coletar_rss', 'sucesso',
        ${JSON.stringify({ coletadas, duplicatas, erros, fontes: FONTES_BR.length + FONTES_YOUTUBE_DEPUTADOS.length })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, coletadas, duplicatas, erros });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Neto Notícias", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
