/**
 * AGENTE RAQUEL RADAR + VICTOR VIRAL + FÁBIO FOMO
 * Monitora declarações virais de deputados de direita.
 * Quando detecta algo relevante, gera análise urgente do Capitão Braga
 * e aciona FOMO nos grupos inferiores.
 * GET /api/cron/radar-politico
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemGrupo, buildFOMO } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// Políticos e empresários de direita monitorados via RSS
const POLITICOS = [
  // Políticos brasileiros
  { nome: "Nikolas Ferreira",   busca: "nikolas ferreira"    },
  { nome: "Eduardo Bolsonaro",  busca: "eduardo bolsonaro"   },
  { nome: "Marco Feliciano",    busca: "feliciano"           },
  { nome: "Damares Alves",      busca: "damares"             },
  { nome: "Sergio Moro",        busca: "sergio moro"         },
  { nome: "General Mourão",     busca: "mourão OR mourao"    },
  // Empresários e figuras de direita brasileiros
  { nome: "Luciano Hang",       busca: "luciano hang"        },
  { nome: "Flávio Augusto",     busca: "flávio augusto"      },
  { nome: "Pablo Marçal",       busca: "pablo marçal"        },
];

// Fontes RSS — apenas as mais rápidas e confiáveis (máx 3 para evitar timeout)
const FONTES_NOTICIAS_RADAR = [
  "https://jovempan.com.br/feed/",
  "https://revistaoeste.com/feed/",
  "https://www.gazetadopovo.com.br/rss/politica.xml",
];

// YouTube RSS dos principais canais de direita e políticos
// Formato: https://www.youtube.com/feeds/videos.xml?channel_id=ID
const FONTES_YOUTUBE_RADAR = [
  { nome: "Jovem Pan News",       url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCvFBSKy7dUNvfMnAT_Rkwig" },
  { nome: "Nikolas Ferreira",     url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCcJiaqLbdHMZUKFABlqP2Kw" },
  { nome: "Eduardo Bolsonaro",    url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCiKLz6Bqm_BKnBRFWfXv_3Q" },
  { nome: "Marco Feliciano",      url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCf7LNrXhz2hOIHPbvYYLfbw" },
  { nome: "Brasil Paralelo",      url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsLo154Krjwbt8ZoNiam149" },
];

// Fontes combinadas para busca
const FONTES_RADAR = [...FONTES_NOTICIAS_RADAR, ...FONTES_YOUTUBE_RADAR.map(y => y.url)];

function extrairLinkItem(bloco: string): string {
  // RSS padrão
  const linkSimples = bloco.match(/<link>([^<]+)<\/link>/);
  if (linkSimples) return linkSimples[1].trim();
  // Atom (YouTube usa href)
  const linkAtom = bloco.match(/<link[^>]+href="([^"]+)"/);
  if (linkAtom) return linkAtom[1].trim();
  // GUID como fallback
  const guid = bloco.match(/<guid[^>]*>([^<]+)<\/guid>/);
  return guid ? guid[1].trim() : "";
}

function extrairTituloItem(bloco: string): string {
  const m = bloco.match(/<title[^>]*>(?:<!\[CDATA\[)?([\s\S]*?)(?:\]\]>)?<\/title>/);
  if (!m) return "";
  return m[1].trim()
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "").replace(/<[^>]+>/g, "");
}

async function buscarMencoesRSS(politico: string): Promise<Array<{ titulo: string; url: string; fonte: string }>> {
  const resultados: Array<{ titulo: string; url: string; fonte: string }> = [];

  for (const rssUrl of FONTES_RADAR) {
    try {
      const res = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const isYoutube = rssUrl.includes("youtube.com");
      const nomeFonte = isYoutube
        ? (FONTES_YOUTUBE_RADAR.find(y => y.url === rssUrl)?.nome || "YouTube")
        : rssUrl.replace(/https?:\/\/(?:www\.)?/, "").split("/")[0];

      // Suporta RSS (<item>) e Atom (<entry>)
      const regex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
      let match;
      let count = 0;

      while ((match = regex.exec(xml)) !== null && count < 5) {
        const bloco = match[1];
        const titulo = extrairTituloItem(bloco);
        const url = extrairLinkItem(bloco);

        if (titulo && url && titulo.toLowerCase().includes(politico.toLowerCase())) {
          resultados.push({ titulo, url, fonte: nomeFonte });
          count++;
        }
      }
    } catch { continue; }
  }

  return resultados;
}

async function gerarAlertaBraga(politico: string, titulo: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 300,
    messages: [{
      role: "user",
      content: `Você é o Capitão Braga, ex-militar evangélico, direto e patriótico.
${politico} disse ou fez algo importante: "${titulo}"

Escreva uma análise urgente e apaixonada em 4-5 linhas no tom conservador e patriótico.
Crie um GANCHO forte no início. Mostre a importância deste momento para o Brasil.
Termine com: "Deus, Pátria e Família — sempre."
Responda APENAS com o texto.`,
    }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
}

async function gerarAlertaCavalcanti(politico: string, titulo: string): Promise<string> {
  const msg = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 350,
    messages: [{
      role: "user",
      content: `Você é o Prof. Bernardo Cavalcanti, analista político global, frio e analítico.
${politico} disse ou fez algo relevante: "${titulo}"

Escreva uma análise em 5-6 linhas: conecte este evento ao cenário político mais amplo (nacional e internacional).
Seja preciso, mostre o que isso significa estrategicamente. Sem emoção excessiva — use dados e contexto.
Termine com: "O mundo muda para quem enxerga antes."
Responda APENAS com o texto.`,
    }],
  });
  return msg.content[0].type === "text" ? msg.content[0].text.trim() : "";
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  // Tempo máximo total: 25s (Vercel tem limite de 30s)
  const LIMITE_MS = 25000;
  let alertasGerados = 0;

  try {
    // Rotaciona 3 políticos por rodada para evitar timeout
    // A cada 30min (48 rodadas/dia), todos os 9 são cobertos ~16x/dia
    const minuto = new Date().getMinutes();
    const hora = new Date().getHours();
    const indiceBase = (hora * 2 + Math.floor(minuto / 30)) % POLITICOS.length;
    const politicosRodada = [
      POLITICOS[indiceBase % POLITICOS.length],
      POLITICOS[(indiceBase + 1) % POLITICOS.length],
      POLITICOS[(indiceBase + 2) % POLITICOS.length],
    ];

    for (const politico of politicosRodada) {
      // Para se ultrapassou o tempo limite
      if (Date.now() - inicio > LIMITE_MS) break;

      const mencoes = await buscarMencoesRSS(politico.nome);

      for (const mencao of mencoes.slice(0, 3)) {
        // Verifica se já foi processado nas últimas 12h
        const jaProcessado = await sql`
          SELECT id FROM radar_politico
          WHERE tweet_id = ${mencao.url}
          AND created_at >= NOW() - INTERVAL '12 hours'
          LIMIT 1
        `;
        if (jaProcessado.length > 0) continue;

        // Registra no radar
        await sql`
          INSERT INTO radar_politico (politico, tweet_id, conteudo, processado)
          VALUES (${politico.nome}, ${mencao.url}, ${mencao.titulo}, false)
          ON CONFLICT (tweet_id) DO NOTHING
        `;

        const isYoutube = mencao.url.includes("youtube.com") || mencao.url.includes("youtu.be");
        const contexto = isYoutube
          ? `${politico.nome} publicou um vídeo: "${mencao.titulo}"`
          : mencao.titulo;

        // Gera duas análises em paralelo: Capitão Braga (VIP) e Prof. Cavalcanti (Elite)
        const [alertaBraga, alertaCavalcanti] = await Promise.all([
          gerarAlertaBraga(politico.nome, contexto),
          gerarAlertaCavalcanti(politico.nome, contexto),
        ]);

        if (!alertaBraga && !alertaCavalcanti) continue;

        // Salva como notícia urgente com ambos os resumos
        const novaNoticia = await sql`
          INSERT INTO noticias (titulo, fonte, url, resumo_braga, resumo_cavalcanti, categoria, urgente, created_at)
          VALUES (${mencao.titulo}, ${politico.nome}, ${mencao.url}, ${alertaBraga}, ${alertaCavalcanti}, 'urgente', true, NOW())
          ON CONFLICT (url) DO NOTHING
          RETURNING id
        `;

        if (novaNoticia.length === 0) continue;
        const noticiaId = novaNoticia[0].id;

        // Victor Viral — Capitão Braga posta SOMENTE no VIP
        if (alertaBraga) {
          const msgVIP = `🚨 *URGENTE — ${politico.nome.toUpperCase()}*\n\n${alertaBraga}`;
          await enviarMensagemGrupo("vip", msgVIP);
          const grupoVIP = await sql`SELECT id FROM grupos_whatsapp WHERE plano = 'vip' LIMIT 1`;
          if (grupoVIP.length > 0) {
            await sql`INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status) VALUES (${grupoVIP[0].id}, ${noticiaId}, ${msgVIP}, 'urgente', 'enviado')`.catch(() => {});
          }
        }

        // Victor Viral — Prof. Cavalcanti posta SOMENTE no Elite
        if (alertaCavalcanti) {
          const msgElite = `📊 *ANÁLISE URGENTE — ${politico.nome.toUpperCase()}*\n\n${alertaCavalcanti}`;
          await enviarMensagemGrupo("elite", msgElite);
          const grupoElite = await sql`SELECT id FROM grupos_whatsapp WHERE plano = 'elite' LIMIT 1`;
          if (grupoElite.length > 0) {
            await sql`INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status) VALUES (${grupoElite[0].id}, ${noticiaId}, ${msgElite}, 'urgente', 'enviado')`.catch(() => {});
          }
        }

        // Fábio FOMO — posta urgência nos grupos inferiores com CTA para VIP
        const fomoBasico = buildFOMO("basico");
        const fomoPatriota = buildFOMO("patriota");
        await Promise.all([
          enviarMensagemGrupo("basico", fomoBasico),
          enviarMensagemGrupo("patriota", fomoPatriota),
        ]);

        // Marca como processado
        await sql`UPDATE radar_politico SET processado = true WHERE tweet_id = ${mencao.url}`;

        alertasGerados++;
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('raquel-radar', 'varredura_politicos', 'sucesso',
        ${JSON.stringify({ alertasGerados, politicosVerificados: politicosRodada.length, indiceBase })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, alertasGerados });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Raquel Radar", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
