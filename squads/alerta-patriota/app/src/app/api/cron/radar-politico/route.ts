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
// periodos: em quais janelas do dia (BRT) a pessoa é monitorada — evita que os 9
// sejam verificados todos de manhã e quase nenhum de noite (pedido do usuário em
// 27/06/2026). Cada pessoa cobre 2 dos 3 períodos, distribuídos para que cada
// período tenha ~6 pessoas ativas (balanceado).
type Periodo = "manha" | "tarde" | "noite";
type Pessoa = { nome: string; busca: string; tipo: "politico" | "empresario"; canalYoutube?: string; periodos: Periodo[] };

const PESSOAS: Pessoa[] = [
  // Políticos brasileiros — canais verificados em 27/06/2026 (os IDs anteriores
  // aqui não correspondiam a nenhum canal real; o coletor de notícias usa os
  // IDs corretos há mais tempo, daqui replicamos os mesmos)
  { nome: "Nikolas Ferreira",   busca: "nikolas ferreira", tipo: "politico", canalYoutube: "UCxI9vN6UbxmBt8VIvUKtJaA", periodos: ["tarde", "noite"] },
  { nome: "Eduardo Bolsonaro",  busca: "eduardo bolsonaro", tipo: "politico", canalYoutube: "UCkR6xPOHhpjq3wnFchVI4sg", periodos: ["manha", "noite"] },
  { nome: "Marco Feliciano",    busca: "feliciano",        tipo: "politico", canalYoutube: "UCpdI21rGF-U3fMoTMCHotSA", periodos: ["manha", "tarde"] },
  { nome: "Damares Alves",      busca: "damares",          tipo: "politico", canalYoutube: "UCUygDoaCJVidyeo9dQFQFnA", periodos: ["tarde", "noite"] },
  { nome: "Sergio Moro",        busca: "sergio moro",       tipo: "politico", periodos: ["manha", "noite"] },
  { nome: "General Mourão",     busca: "mourão OR mourao",  tipo: "politico", periodos: ["manha", "tarde"] },
  // Empresários de direita — canais verificados em 27/06/2026
  { nome: "Luciano Hang",       busca: "luciano hang",     tipo: "empresario", canalYoutube: "UCQVGpvqkT_VI_qKg6MYqeWA", periodos: ["tarde", "noite"] },
  { nome: "Flávio Augusto",     busca: "flávio augusto",   tipo: "empresario", canalYoutube: "UCP3PkxfP6A_KqbaCOBEQQuA", periodos: ["manha", "noite"] },
  { nome: "Pablo Marçal",       busca: "pablo marçal",     tipo: "empresario", canalYoutube: "UCbroBIg8zvIH8-F4631wJhA", periodos: ["manha", "tarde"] },
];

// Limite de alertas gerados por pessoa por dia — evita inundar os grupos quando
// alguém publica vários vídeos no mesmo dia (pedido do usuário em 27/06/2026).
const CAP_DIARIO_POR_PESSOA = 2;

function obterPeriodoAtual(): Periodo | null {
  const hora = parseInt(
    new Date().toLocaleString("pt-BR", { hour: "numeric", timeZone: "America/Sao_Paulo" })
  );
  if (hora >= 6 && hora < 12) return "manha";
  if (hora >= 12 && hora < 18) return "tarde";
  if (hora >= 18 && hora < 24) return "noite";
  return null; // madrugada (0h-6h): sem monitoramento, pouco conteúdo real nesse horário
}

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

// Item 19 (Fase 30): o mesmo vídeo pode ser encontrado pela busca no canal próprio (URL limpa,
// vinda do Atom feed do YouTube) e pela busca genérica em portais/canais de mídia (URL do mesmo
// vídeo, mas com parâmetros de tracking como ?si=..., &feature=... ou utm_*, vindos de como o
// link foi embedado na fonte) — como o dedup (jaProcessado e os ON CONFLICT em radar_politico/
// noticias) compara a URL como texto exato, as duas variantes nunca batiam e a mesma análise
// era gerada duas vezes. Normaliza para a forma canônica (youtube.com/watch?v=ID) antes de
// qualquer busca/inserção, então as duas vias convergem para a mesma chave de dedup.
function normalizarUrlVideo(url: string): string {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([\w-]{11})/);
  return m ? `https://www.youtube.com/watch?v=${m[1]}` : url;
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

    const periodoAtual = obterPeriodoAtual();

    // Item 22 (Fase 30): a contagem diária por pessoa rodava 1 SELECT COUNT(*) por pessoa
    // DENTRO do loop (N+1 — 3 round-trips por execução, sem nenhum índice em
    // radar_politico.politico, então cada COUNT(*) varria a tabela inteira). Agora busca
    // em lote, fora do loop, a contagem das 3 pessoas da rodada numa única query agrupada.
    const nomesRodada = rodada.map(p => p.nome);
    const contagensRows = await sql`
      SELECT politico, COUNT(*)::int AS total FROM radar_politico
      WHERE politico = ANY(${nomesRodada})
      AND processado = true
      AND (created_at AT TIME ZONE 'America/Sao_Paulo')::date = (NOW() AT TIME ZONE 'America/Sao_Paulo')::date
      GROUP BY politico
    `;
    const contagensPorPessoa = new Map(contagensRows.map(r => [r.politico as string, r.total as number]));

    for (const pessoa of rodada) {
      // Para se ultrapassou o tempo limite
      if (Date.now() - inicio > LIMITE_MS) break;

      // Pessoa só é monitorada na(s) janela(s) do dia atribuída(s) a ela
      if (periodoAtual && !pessoa.periodos.includes(periodoAtual)) continue;

      // Conta quantos alertas essa pessoa já gerou hoje (BRT) — para respeitar o cap diário
      let alertasHojePessoa = contagensPorPessoa.get(pessoa.nome) ?? 0;
      if (alertasHojePessoa >= CAP_DIARIO_POR_PESSOA) continue;

      const mencoes = [
        ...(await buscarVideosCanalProprio(pessoa)),
        ...(await buscarMencoesGenericas(pessoa)),
      ].map(m => ({ ...m, url: normalizarUrlVideo(m.url) }));

      for (const mencao of mencoes.slice(0, 3)) {
        if (alertasHojePessoa >= CAP_DIARIO_POR_PESSOA) break;

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
        alertasHojePessoa++;
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
