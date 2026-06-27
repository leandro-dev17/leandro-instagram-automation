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
// urgente=true + categoria=curada: bypassa o curador, vai direto pro resumidor
const FONTES_YOUTUBE_DEPUTADOS = [
  { nome: "Nikolas Ferreira",  url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCxI9vN6UbxmBt8VIvUKtJaA", urgente: true, curada: true },
  { nome: "Eduardo Bolsonaro", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCkR6xPOHhpjq3wnFchVI4sg", urgente: true, curada: true },
  { nome: "Marco Feliciano",   url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCpdI21rGF-U3fMoTMCHotSA", urgente: true, curada: true },
  { nome: "Damares Alves",     url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCUygDoaCJVidyeo9dQFQFnA", urgente: true, curada: true },
  { nome: "Gustavo Gayer",     url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCbmVlqWD6lqn1Ur1Zv25IIg", urgente: true, curada: true },
  { nome: "Jair Bolsonaro",    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UC8hGUtfEgvvnp6IaHSAg1OQ", urgente: true, curada: true },
  { nome: "Flávio Bolsonaro",  url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCl2HptoHv6PjZMQAwTdA--Q", urgente: true, curada: true },
  { nome: "Jovem Pan News",    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCvFBSKy7dUNvfMnAT_Rkwig", urgente: false, curada: false },
];

function fixMojibake(s: string): string {
  let result = "";
  let i = 0;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    if ((code === 0xC2 || code === 0xC3) && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0x80 && next <= 0xBF) {
        result += String.fromCodePoint(((code & 0x1F) << 6) | (next & 0x3F));
        i += 2;
        continue;
      }
    }
    result += s[i];
    i++;
  }
  return result;
}

function extrairTag(xml: string, tag: string): string {
  const m = xml.match(new RegExp(`<${tag}[^>]*>(?:<!\\[CDATA\\[)?(.*?)(?:\\]\\]>)?<\\/${tag}>`, "s"));
  if (!m) return "";
  const texto = m[1].trim()
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#8217;/g, "'").replace(/&#8220;/g, '"').replace(/&#8221;/g, '"')
    .replace(/&nbsp;/g, " ").replace(/&#\d+;/g, "");
  return fixMojibake(texto);
}

function extrairLink(item: string): string {
  // RSS 2.0: <link>URL</link> (texto)
  const link = item.match(/<link>([^<]+)<\/link>/);
  if (link) return link[1].trim();
  // Atom (feeds de canal do YouTube): <link rel="alternate" href="URL"/> — tag
  // self-closing com atributo, sem texto entre tags. Sem este fallback, todo item
  // dos 8 canais/deputados em FONTES_YOUTUBE_DEPUTADOS ficava com url="" e nunca
  // passava do filtro `url.startsWith("http")" — coleta morta silenciosamente.
  const atomLink = item.match(/<link[^>]*\shref="([^"]+)"/);
  if (atomLink) return atomLink[1].trim();
  const guid = item.match(/<guid[^>]*>([^<]+)<\/guid>/);
  return guid ? guid[1].trim() : "";
}

// O resumidor (resumir-noticias) escrevia o resumo só com o título da manchete,
// porque conteudo_original nunca era preenchido aqui — sem nenhum fato real para
// trabalhar, a IA só conseguia produzir gancho + frase de efeito, sem substância.
// Pega o melhor texto disponível no próprio feed: content:encoded (corpo completo,
// comum em feeds WordPress) > description (resumo editorial) > media:description
// (descrição de vídeo do YouTube), removendo HTML residual.
function extrairConteudo(bloco: string): string {
  const candidatos = [
    extrairTag(bloco, "content:encoded"),
    extrairTag(bloco, "description"),
    extrairTag(bloco, "media:description"),
  ].filter(Boolean);
  if (candidatos.length === 0) return "";
  const maior = candidatos.reduce((a, b) => (b.length > a.length ? b : a));
  return maior.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 2000);
}

async function coletarRSS(fonte: typeof FONTES_BR[0]): Promise<Array<{ titulo: string; url: string; fonte: string; categoria: string; conteudo: string }>> {
  try {
    const res = await fetch(fonte.url, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const itens: Array<{ titulo: string; url: string; fonte: string; categoria: string; conteudo: string }> = [];

    // Divide por <item> ou <entry> (RSS e Atom)
    const regex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
    let match;
    let count = 0;

    while ((match = regex.exec(xml)) !== null && count < 8) {
      const bloco = match[1];
      const titulo = extrairTag(bloco, "title");
      const url = extrairLink(bloco);

      if (titulo && url && url.startsWith("http")) {
        itens.push({ titulo, url, fonte: fonte.nome, categoria: fonte.categoria, conteudo: extrairConteudo(bloco) });
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
      ...FONTES_BR.map(f => ({ ...f, urgente: false, curada: false })),
      ...FONTES_YOUTUBE_DEPUTADOS.map(f => ({ ...f, categoria: "politica" })),
    ];

    for (const fonte of todasFontes) {
      const noticias = await coletarRSS(fonte);

      for (const n of noticias) {
        try {
          // FASE 23: SELECT (checar duplicata) + INSERT em requisições separadas deixava uma
          // janela onde 2 fontes com a mesma URL (ou 2 execuções concorrentes do cron)
          // passavam ambas pelo SELECT antes de qualquer uma inserir — INSERT...ON CONFLICT
          // fecha essa janela usando o índice único noticias_url_unique (admin/setup).
          const isCurada = (n as { curada?: boolean }).curada ?? false;
          const inserida = await sql`
            INSERT INTO noticias (titulo, fonte, url, categoria, urgente, created_at, conteudo_original)
            VALUES (
              ${n.titulo}, ${n.fonte}, ${n.url},
              ${isCurada ? "curada" : (n.categoria ?? "politica")},
              ${(n as { urgente?: boolean }).urgente ?? false},
              NOW(),
              ${n.conteudo || null}
            )
            ON CONFLICT (url) WHERE url IS NOT NULL DO NOTHING
            RETURNING id
          `;
          if (inserida.length > 0) coletadas++; else duplicatas++;
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
