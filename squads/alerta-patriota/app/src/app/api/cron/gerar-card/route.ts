/**
 * AGENTE GERADOR DE CARDS
 * Renderiza HTML → PNG via Puppeteer e envia como imagem no WhatsApp
 * com a análise completa na legenda (caption)
 * GET /api/cron/gerar-card?plano=vip|elite
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { gerarHTMLCard } from "@/lib/card-generator";
import { gerarTexto } from "@/lib/ai";

const EVO_URL  = process.env.EVOLUTION_API_URL;
const EVO_KEY  = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || "alertapatriota";

const GROUP_IDS: Record<string, string> = {
  vip:      process.env.WPP_GROUP_VIP      || "",
  elite:    process.env.WPP_GROUP_ELITE    || "",
};

// Prompts para gerar o HOOK (frase de impacto para a imagem)
const PROMPTS_HOOK: Record<string, string> = {
  vip:      `Crie UMA frase bombástica e reveladora (máximo 12 palavras) que cause IMPACTO e CURIOSIDADE sobre esta notícia. Tom: "o que a mídia esconde". SEM aspas.`,
  elite:    `Crie UMA frase analítica e sofisticada (máximo 12 palavras) do Prof. Bernardo Cavalcanti sobre esta notícia. Tom intelectual e revelador. SEM aspas.`,
};

// Prompts para a LEGENDA completa (caption da imagem)
const PROMPTS_LEGENDA: Record<string, string> = {
  vip: `Você é o Capitão Braga. Escreva análise em 3 partes usando este formato EXATO:

🧠 *O QUE ESTÁ ACONTECENDO*
[2-3 linhas sobre o fato]

🔍 *O QUE A MÍDIA ESCONDE*
[2-3 linhas revelando o que está por trás]

🎯 *O QUE ISSO SIGNIFICA*
[2-3 linhas sobre implicação para o Brasil]

Termine com: Deus, Pátria e Família — sempre.
Use apenas *negrito* (asterisco simples). Responda APENAS com o texto.`,

  elite: `Você é o Prof. Bernardo Cavalcanti. Escreva análise em 3 partes usando este formato EXATO:

🧠 *O QUE ESTÁ ACONTECENDO*
[2-3 linhas sobre o fato]

🌍 *MAPA GLOBAL*
[2-3 linhas conectando a Milei, Trump, Orbán ou movimentos conservadores globais]

🎯 *O QUE VOCÊ PRECISA SABER*
[2-3 linhas sobre implicação estratégica para o Brasil]

Termine com: O mundo muda para quem enxerga antes.
Use apenas *negrito* (asterisco simples). Responda APENAS com o texto.`,
};

async function gerarHook(titulo: string, plano: string): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 60,
    messages: [{ role: "user", content: `${PROMPTS_HOOK[plano]}\n\nNOTÍCIA: "${titulo}"` }],
  });
  return texto ? texto.replace(/["""]/g, "") : titulo;
}

async function gerarLegenda(titulo: string, plano: string, fonte: string): Promise<string> {
  const hora = new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" });
  const data = new Date().toLocaleDateString("pt-BR", { day:"numeric", month:"short", timeZone:"America/Sao_Paulo" });

  const corpo = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{ role: "user", content: `${PROMPTS_LEGENDA[plano]}\n\nNOTÍCIA: "${titulo}"\nFONTE: ${fonte}` }],
  });

  // Header formatado por grupo
  const headers: Record<string, string> = {
    vip:      `╔══════════════════╗\n║   🔥 VIP PREMIUM   ║\n╚══════════════════╝\n_${data} · ${hora} · ${fonte}_\n`,
    elite:    `╔══════════════════╗\n║  🎖️  ELITE GLOBAL  ║\n╚══════════════════╝\n*Prof. Dr. Bernardo Cavalcanti*\n_${data} · ${hora} · ${fonte}_\n`,
  };

  return `${headers[plano]}\n${corpo}`;
}

async function renderizarEEnviar(html: string, groupJid: string, legenda: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY) return false;

  // Renderiza HTML → PNG base64 via Puppeteer
  let puppeteer;
  try { puppeteer = await import("puppeteer"); } catch { return false; }

  const browser = await puppeteer.default.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-gpu"],
  });

  let pngBase64 = "";
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1080 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 20000 });
    const screenshot = await page.screenshot({ type: "png", clip: { x:0, y:0, width:1080, height:1080 } });
    pngBase64 = Buffer.from(screenshot).toString("base64");
  } finally {
    await browser.close();
  }

  if (!pngBase64) return false;

  // Envia imagem com legenda via Evolution API
  const res = await fetch(`${EVO_URL}/message/sendMedia/${EVO_INST}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({
      number: groupJid,
      mediatype: "image",
      media: pngBase64,
      caption: legenda,
      fileName: "alerta-patriota.png",
    }),
  });

  return res.ok;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const plano = searchParams.get("plano") || "vip";

  if (!["vip","elite"].includes(plano)) {
    return NextResponse.json({ erro: "Plano inválido" }, { status: 400 });
  }

  const groupJid = GROUP_IDS[plano];
  if (!groupJid) return NextResponse.json({ erro: "Grupo não configurado" }, { status: 400 });

  const inicio = Date.now();

  try {
    // Busca notícia do dia não publicada
    const rows = plano === "vip"
      ? await sql`SELECT id, titulo, url, fonte, urgente, resumo_braga, resumo_cavalcanti FROM noticias WHERE postada_vip = false AND resumo_braga IS NOT NULL AND (global IS NULL OR global = false) ORDER BY urgente DESC, created_at DESC LIMIT 1`
      : await sql`SELECT id, titulo, url, fonte, urgente, resumo_braga, resumo_cavalcanti FROM noticias WHERE postada_elite = false AND resumo_cavalcanti IS NOT NULL ORDER BY urgente DESC, global DESC, created_at DESC LIMIT 1`;

    if (!rows.length) return NextResponse.json({ ok: true, publicado: false, motivo: "sem notícia disponível" });

    const n = rows[0];
    const fonte = n.fonte || "Alerta Patriota";

    // Gera hook e legenda em paralelo
    const [hook, legenda] = await Promise.all([
      gerarHook(n.titulo, plano),
      gerarLegenda(n.titulo, plano, fonte),
    ]);

    // Gera o HTML do card
    const html = gerarHTMLCard({
      plano: plano as "vip" | "elite",
      hook,
      fonte,
      urgente: n.urgente === true || n.urgente === "true",
    });

    // Renderiza e envia
    const enviado = await renderizarEEnviar(html, groupJid, legenda);

    if (enviado) {
      // Marca como publicada
      if (plano === "vip")      await sql`UPDATE noticias SET postada_vip = true, postada_vip_at = NOW() WHERE id = ${n.id}`;
      if (plano === "elite")    await sql`UPDATE noticias SET postada_elite = true, postada_elite_at = NOW() WHERE id = ${n.id}`;

      // Log
      const grupoRow = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${plano} LIMIT 1`;
      if (grupoRow.length > 0) {
        await sql`INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status) VALUES (${grupoRow[0].id}, ${n.id}, ${legenda}, 'card_visual', 'enviado')`;
      }
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms) VALUES ('gerador-card', ${`card_${plano}`}, ${enviado ? "sucesso" : "erro"}, ${JSON.stringify({ plano, noticiaId: n.id, hook })}, ${Date.now() - inicio})`;

    return NextResponse.json({ ok: true, publicado: enviado, plano, hook, noticia: n.titulo });
  } catch (err) {
    await alertarTelegram("🔴", `Falha Gerador Card (${plano})`, String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
