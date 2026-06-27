/**
 * AGENTE RAQUEL RADAR + VICTOR VIRAL + FÁBIO FOMO
 * Monitora declarações virais de deputados de direita e empresários conservadores.
 * Quando detecta algo relevante, gera análise urgente do Capitão Braga (políticos,
 * só Brasil) e do Prof. Cavalcanti (políticos e empresários, ângulo global/econômico).
 * GET /api/cron/radar-politico
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import { gerarTexto } from "@/lib/ai";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

// Políticos e empresários de direita monitorados.
// canalYoutube = canal pessoal verificado (ver auditoria de 27/06/2026): todo vídeo
// publicado nele é tratado como relevante automaticamente — sem isso, o filtro por
// nome-no-título nunca batia, porque o vídeo de alguém no próprio canal raramente
// tem o nome dela no título. Sem canalYoutube, a pessoa só é encontrada via busca
// por nome nos portais de notícia e nos canais de mídia genéricos.
// tipo "empresario": só gera análise do Prof. Cavalcanti (Elite) — Capitão Braga
// comenta exclusivamente notícias do Brasil sobre política, não sobre empresários.
type Pessoa = { nome: string; busca: string; tipo: "politico" | "empresario"; canalYoutube?: string };

const PESSOAS: Pessoa[] = [
  // Políticos brasileiros — canais verificados em 27/06/2026 (os IDs anteriores
  // aqui não correspondiam a nenhum canal real; o coletor de notícias usa os
  // IDs corretos há mais tempo, daqui replicamos os mesmos)
  { nome: "Nikolas Ferreira",   busca: "nikolas ferreira", tipo: "politico", canalYoutube: "UCxI9vN6UbxmBt8VIvUKtJaA" },
  { nome: "Eduardo Bolsonaro",  busca: "eduardo bolsonaro", tipo: "politico", canalYoutube: "UCkR6xPOHhpjq3wnFchVI4sg" },
  { nome: "Marco Feliciano",    busca: "feliciano",        tipo: "politico", canalYoutube: "UCpdI21rGF-U3fMoTMCHotSA" },
  { nome: "Damares Alves",      busca: "damares",          tipo: "politico", canalYoutube: "UCUygDoaCJVidyeo9dQFQFnA" },
  { nome: "Sergio Moro",        busca: "sergio moro",       tipo: "politico" },
  { nome: "General Mourão",     busca: "mourão OR mourao",  tipo: "politico" },
  // Empresários de direita — canais verificados em 27/06/2026
  { nome: "Luciano Hang",       busca: "luciano hang",     tipo: "empresario", canalYoutube: "UCQVGpvqkT_VI_qKg6MYqeWA" },
  { nome: "Flávio Augusto",     busca: "flávio augusto",   tipo: "empresario", canalYoutube: "UCP3PkxfP6A_KqbaCOBEQQuA" },
  { nome: "Pablo Marçal",       busca: "pablo marçal",     tipo: "empresario", canalYoutube: "UCbroBIg8zvIH8-F4631wJhA" },
];

// Fontes RSS — apenas as mais rápidas e confiáveis (máx 3 para evitar timeout)
const FONTES_NOTICIAS_RADAR = [
  "https://jovempan.com.br/feed/",
  "https://revistaoeste.com/feed/",
  "https://www.gazetadopovo.com.br/rss/politica.xml",
];

// Canais de mídia (não pertencem a uma pessoa específica) — aqui o filtro por
// nome-no-título faz sentido, porque cobrem múltiplos temas/convidados.
const FONTES_YOUTUBE_MIDIA = [
  { nome: "Jovem Pan News",  url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCvFBSKy7dUNvfMnAT_Rkwig" },
  { nome: "Brasil Paralelo", url: "https://www.youtube.com/feeds/videos.xml?channel_id=UCsLo154Krjwbt8ZoNiam149" },
];

const FONTES_GENERICAS = [...FONTES_NOTICIAS_RADAR, ...FONTES_YOUTUBE_MIDIA.map(m => m.url)];

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

// Busca menções nos portais de notícia e canais de mídia genéricos — exige que o
// nome da pessoa apareça no título, já que essas fontes cobrem múltiplos temas.
async function buscarMencoesGenericas(pessoa: Pessoa): Promise<Array<{ titulo: string; url: string; fonte: string }>> {
  const resultados: Array<{ titulo: string; url: string; fonte: string }> = [];

  for (const rssUrl of FONTES_GENERICAS) {
    try {
      const res = await fetch(rssUrl, {
        headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const isYoutube = rssUrl.includes("youtube.com");
      const nomeFonte = isYoutube
        ? (FONTES_YOUTUBE_MIDIA.find(y => y.url === rssUrl)?.nome || "YouTube")
        : rssUrl.replace(/https?:\/\/(?:www\.)?/, "").split("/")[0];

      const regex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
      let match;
      let count = 0;

      while ((match = regex.exec(xml)) !== null && count < 5) {
        const bloco = match[1];
        const titulo = extrairTituloItem(bloco);
        const url = extrairLinkItem(bloco);

        if (titulo && url && titulo.toLowerCase().includes(pessoa.busca.toLowerCase())) {
          resultados.push({ titulo, url, fonte: nomeFonte });
          count++;
        }
      }
    } catch { continue; }
  }

  return resultados;
}

// Busca direta no canal pessoal verificado da pessoa — todo vídeo publicado é
// relevante por definição (é o próprio canal dela), sem exigir nome no título.
async function buscarVideosCanalProprio(pessoa: Pessoa): Promise<Array<{ titulo: string; url: string; fonte: string }>> {
  if (!pessoa.canalYoutube) return [];

  try {
    const res = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${pessoa.canalYoutube}`, {
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];

    const xml = await res.text();
    const resultados: Array<{ titulo: string; url: string; fonte: string }> = [];
    const regex = /<entry>([\s\S]*?)<\/entry>/g;
    let match;
    let count = 0;

    while ((match = regex.exec(xml)) !== null && count < 3) {
      const titulo = extrairTituloItem(match[1]);
      const url = extrairLinkItem(match[1]);
      if (titulo && url) {
        resultados.push({ titulo, url, fonte: `YouTube/${pessoa.nome}` });
        count++;
      }
    }
    return resultados;
  } catch {
    return [];
  }
}

async function gerarAlertaBraga(politico: string, titulo: string): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "raquel-radar",
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
  return texto;
}

async function gerarAlertaCavalcanti(pessoa: string, titulo: string): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "raquel-radar",
    max_tokens: 350,
    messages: [{
      role: "user",
      content: `Você é o Prof. Bernardo Cavalcanti, analista político global, frio e analítico.
${pessoa} disse ou fez algo relevante: "${titulo}"

Escreva uma análise em 5-6 linhas: conecte este evento ao cenário político e econômico mais amplo (nacional e internacional).
Seja preciso, mostre o que isso significa estrategicamente. Sem emoção excessiva — use dados e contexto.
Termine com: "O mundo muda para quem enxerga antes."
Responda APENAS com o texto.`,
    }],
  });
  return texto;
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
    // Rotaciona 3 pessoas por rodada para evitar timeout
    // A cada 30min (48 rodadas/dia), todas as 9 são cobertas ~16x/dia
    const minuto = new Date().getMinutes();
    const hora = parseInt(
      new Date().toLocaleString("pt-BR", { hour: "numeric", timeZone: "America/Sao_Paulo" })
    );
    const indiceBase = (hora * 2 + Math.floor(minuto / 30)) % PESSOAS.length;
    const rodada = [
      PESSOAS[indiceBase % PESSOAS.length],
      PESSOAS[(indiceBase + 1) % PESSOAS.length],
      PESSOAS[(indiceBase + 2) % PESSOAS.length],
    ];

    for (const pessoa of rodada) {
      // Para se ultrapassou o tempo limite
      if (Date.now() - inicio > LIMITE_MS) break;

      const mencoes = [
        ...(await buscarVideosCanalProprio(pessoa)),
        ...(await buscarMencoesGenericas(pessoa)),
      ];

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
          VALUES (${pessoa.nome}, ${mencao.url}, ${mencao.titulo}, false)
          ON CONFLICT (tweet_id) DO NOTHING
        `;

        const isYoutube = mencao.url.includes("youtube.com") || mencao.url.includes("youtu.be");
        const contexto = isYoutube
          ? `${pessoa.nome} publicou um vídeo: "${mencao.titulo}"`
          : mencao.titulo;

        // Capitão Braga só comenta política do Brasil — empresários ficam só com
        // a análise do Prof. Cavalcanti (ângulo global/econômico)
        const [alertaBraga, alertaCavalcanti] = await Promise.all([
          pessoa.tipo === "empresario" ? Promise.resolve("") : gerarAlertaBraga(pessoa.nome, contexto),
          gerarAlertaCavalcanti(pessoa.nome, contexto),
        ]);

        if (!alertaBraga && !alertaCavalcanti) continue;

        // Salva como notícia urgente com ambos os resumos
        const novaNoticia = await sql`
          INSERT INTO noticias (titulo, fonte, url, resumo_braga, resumo_cavalcanti, categoria, urgente, created_at)
          VALUES (${mencao.titulo}, ${pessoa.nome}, ${mencao.url}, ${alertaBraga || null}, ${alertaCavalcanti}, 'urgente', true, NOW())
          ON CONFLICT (url) WHERE url IS NOT NULL DO NOTHING
          RETURNING id
        `;

        if (novaNoticia.length === 0) continue;
        const noticiaId = novaNoticia[0].id;

        // Victor Viral — Capitão Braga posta SOMENTE no VIP
        if (alertaBraga) {
          const msgVIP = `🚨 *URGENTE — ${pessoa.nome.toUpperCase()}*\n\n${alertaBraga}`;
          // FASE 23: status 'enviado' era gravado incondicionalmente, mesmo quando o envio
          // ao WhatsApp falhava — mascarando falhas reais no histórico de posts.
          const enviadoVip = await enviarMensagemGrupo("vip", msgVIP);
          if (!enviadoVip) {
            await alertarTelegram("🔴", "Radar Político — falha ao enviar alerta urgente no VIP", `pessoa: ${pessoa.nome} | url: ${mencao.url}`);
          }
          const grupoVIP = await sql`SELECT id FROM grupos_whatsapp WHERE plano = 'vip' LIMIT 1`;
          if (grupoVIP.length > 0) {
            await sql`INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status) VALUES (${grupoVIP[0].id}, ${noticiaId}, ${msgVIP}, 'urgente', ${enviadoVip ? "enviado" : "erro"})`.catch(() => {});
          }
        }

        // Victor Viral — Prof. Cavalcanti posta SOMENTE no Elite
        if (alertaCavalcanti) {
          const msgElite = `📊 *ANÁLISE URGENTE — ${pessoa.nome.toUpperCase()}*\n\n${alertaCavalcanti}`;
          const enviadoElite = await enviarMensagemGrupo("elite", msgElite);
          if (!enviadoElite) {
            await alertarTelegram("🔴", "Radar Político — falha ao enviar análise urgente no Elite", `pessoa: ${pessoa.nome} | url: ${mencao.url}`);
          }
          const grupoElite = await sql`SELECT id FROM grupos_whatsapp WHERE plano = 'elite' LIMIT 1`;
          if (grupoElite.length > 0) {
            await sql`INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status) VALUES (${grupoElite[0].id}, ${noticiaId}, ${msgElite}, 'urgente', ${enviadoElite ? "enviado" : "erro"})`.catch(() => {});
          }
        }

        // Marca como processado
        await sql`UPDATE radar_politico SET processado = true WHERE tweet_id = ${mencao.url}`;

        alertasGerados++;
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('raquel-radar', 'varredura_politicos', 'sucesso',
        ${JSON.stringify({ alertasGerados, pessoasVerificadas: rodada.length, indiceBase })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, alertasGerados });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Raquel Radar", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
