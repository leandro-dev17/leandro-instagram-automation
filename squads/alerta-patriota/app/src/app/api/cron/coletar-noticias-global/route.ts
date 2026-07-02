/**
 * AGENTE IGOR INTERNACIONAL
 * Coleta notícias conservadoras internacionais 3x/dia via RSS.
 * Fontes: Breitbart, Daily Wire, Fox News, La Nacion (Argentina), Infobae.
 * Também monitora Twitter/X de Elon Musk, Trump, Milei, Thiel via RSS.
 * GET /api/cron/coletar-noticias-global
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const FONTES_GLOBAL = [
  { nome: "Breitbart",      url: "https://feeds.feedburner.com/breitbart",                   idioma: "en", regiao: "usa"       },
  { nome: "Daily Wire",     url: "https://www.dailywire.com/feeds/rss.xml",                  idioma: "en", regiao: "usa"       },
  { nome: "Fox News",       url: "https://moxie.foxnews.com/google-publisher/politics.xml",  idioma: "en", regiao: "usa"       },
  { nome: "La Nacion",      url: "https://www.lanacion.com.ar/arcio/rss/",                   idioma: "es", regiao: "argentina" },
  { nome: "Infobae",        url: "https://www.infobae.com/feeds/rss/",                       idioma: "es", regiao: "argentina" },
  { nome: "The Federalist", url: "https://thefederalist.com/feed/",                          idioma: "en", regiao: "usa"       },
  { nome: "Epoch Times BR", url: "https://br.theepochtimes.com/feed",                        idioma: "pt", regiao: "global"    },
];

// YouTube RSS — Líderes conservadores internacionais (Elite Global apenas)
// curada=true: bypassa o curador, vai direto para o Prof. Cavalcanti resumir
const FONTES_YOUTUBE_LIDERES_INTERNACIONAIS = [
  { nome: "Javier Milei",   url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC88n6E9PYX3w-OtJpXPb60A", urgente: true, curada: true },
  { nome: "Donald Trump",   url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCAql2DyGU2un1Ei2nMYsqOA", urgente: true, curada: true },
  { nome: "Giorgia Meloni", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC6wP9lyGnU9Znt4idvQhKLg", urgente: true, curada: true },
  { nome: "VOX España",     url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCRvpumrJs0qY1xLzeU0Ss1Q", urgente: false, curada: true },
];

function extrairTitulo(bloco: string): string {
  const m = bloco.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  if (!m) return "";
  return m[1].trim()
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "").replace(/<[^>]+>/g, "").trim();
}

function extrairLink(bloco: string): string {
  const link = bloco.match(/<link>([^<]+)<\/link>/);
  if (link) return link[1].trim();
  const atom = bloco.match(/<link[^>]+href="([^"]+)"/);
  return atom ? atom[1].trim() : "";
}

// Sem isto, conteudo_original ficava sempre NULL e o resumidor (resumir-noticias-global)
// só recebia o título — a IA escrevia gancho sem nenhum fato real para se basear nele.
function extrairConteudo(bloco: string): string {
  const candidatos = [
    bloco.match(/<content:encoded[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/content:encoded>/)?.[1] || "",
    bloco.match(/<description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/description>/)?.[1] || "",
    bloco.match(/<media:description[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/media:description>/)?.[1] || "",
  ].filter(Boolean);
  if (candidatos.length === 0) return "";
  const maior = candidatos.reduce((a, b) => (b.length > a.length ? b : a));
  return maior.trim()
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#\d+;/g, "")
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
}

// Item 18 (Fase 30): retornava só o array de itens — uma fonte fora do ar (timeout, DNS,
// URL mudou, HTTP erro) e uma fonte sem nada de novo publicado produziam exatamente o mesmo
// resultado ([]), então uma fonte quebrada há semanas passava para sempre sem nenhum alerta.
async function coletarFonte(fonte: typeof FONTES_GLOBAL[0]): Promise<{ itens: Array<{titulo: string; url: string; fonte: string; categoria: string; global: boolean; conteudo: string}>; falhou: boolean }> {
  try {
    const res = await fetch(fonte.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { itens: [], falhou: true };

    const xml = await res.text();
    const itens: Array<{titulo: string; url: string; fonte: string; categoria: string; global: boolean; conteudo: string}> = [];
    const regex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
    let match;
    let count = 0;

    while ((match = regex.exec(xml)) !== null && count < 6) {
      const titulo = extrairTitulo(match[1]);
      const url = extrairLink(match[1]);

      if (titulo && url && url.startsWith("http")) {
        // Traduz título se necessário (marca para o resumidor traduzir)
        const tituloFinal = fonte.idioma !== "pt" ? `[${fonte.idioma.toUpperCase()}] ${titulo}` : titulo;
        itens.push({ titulo: tituloFinal, url, fonte: fonte.nome, categoria: "mundial", global: true, conteudo: extrairConteudo(match[1]) });
        count++;
      }
    }
    return { itens, falhou: false };
  } catch {
    return { itens: [], falhou: true };
  }
}

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  let coletadas = 0;
  let duplicatas = 0;
  const fontesComFalha: Array<{ nome: string; url: string }> = [];

  try {
    const todasFontes = [...FONTES_GLOBAL];

    for (const fonte of todasFontes) {
      const { itens: noticias, falhou } = await coletarFonte(fonte);
      if (falhou) fontesComFalha.push({ nome: fonte.nome, url: fonte.url });

      for (const n of noticias) {
        // FASE 23: SELECT+INSERT separados deixavam janela de duplicata entre execuções
        // concorrentes — INSERT...ON CONFLICT fecha a janela via noticias_url_unique.
        const inserida = await sql`
          INSERT INTO noticias (titulo, fonte, url, categoria, global, created_at, conteudo_original)
          VALUES (${n.titulo}, ${n.fonte}, ${n.url}, ${n.categoria}, true, NOW(), ${n.conteudo || null})
          ON CONFLICT (url) WHERE url IS NOT NULL DO NOTHING
          RETURNING id
        `;
        if (inserida.length > 0) coletadas++; else duplicatas++;
      }
    }

    // Coleta YouTube dos líderes conservadores internacionais
    for (const lider of FONTES_YOUTUBE_LIDERES_INTERNACIONAIS) {
      try {
        const res = await fetch(lider.url, {
          headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
          signal: AbortSignal.timeout(8000),
        });
        if (!res.ok) { fontesComFalha.push({ nome: lider.nome, url: lider.url }); continue; }

        const xml = await res.text();
        const regex = /<entry>([\s\S]*?)<\/entry>/g;
        let match;
        let count = 0;

        while ((match = regex.exec(xml)) !== null && count < 3) {
          const titulo = match[1].match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/)?.[1]?.trim() || "";
          const url = match[1].match(/<link[^>]+href="([^"]+)"/)?.[1]?.trim() || "";

          if (!titulo || !url) continue;

          const inserida = await sql`
            INSERT INTO noticias (titulo, fonte, url, categoria, urgente, global, created_at, conteudo_original)
            VALUES (
              ${titulo}, ${lider.nome}, ${url},
              'curada',
              ${lider.urgente},
              true,
              NOW(),
              ${extrairConteudo(match[1]) || null}
            )
            ON CONFLICT (url) WHERE url IS NOT NULL DO NOTHING
            RETURNING id
          `;
          if (inserida.length > 0) coletadas++; else duplicatas++;
          count++;
        }
      } catch { fontesComFalha.push({ nome: lider.nome, url: lider.url }); }
    }

    // Item 18 (Fase 30): dedup por fonte (6h) — evita alerta repetido a cada execução
    // (3x/dia) enquanto a mesma fonte continuar fora do ar, mesmo padrão já usado em
    // fiscal-noticias.ts/criarAlertaDedup.
    for (const f of fontesComFalha) {
      const { criado } = await criarAlertaDedup(
        `coleta_rss_global_falha:${f.nome}`,
        "medio",
        `Fonte "${f.nome}" falhou ao coletar (timeout, erro de rede ou HTTP não-OK) — verifique se a URL ainda é válida: ${f.url}`
      );
      if (criado) {
        await alertarTelegram("🟡", "Fonte RSS global com falha", `"${f.nome}" não respondeu — ${f.url}`).catch(() => {});
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('igor-internacional', 'coletar_rss_global', 'sucesso',
        ${JSON.stringify({ coletadas, duplicatas, fontes: todasFontes.length, fontes_falha: fontesComFalha.map(f => f.nome) })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, coletadas, duplicatas, fontes_falha: fontesComFalha.map(f => f.nome) });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Igor Internacional", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
