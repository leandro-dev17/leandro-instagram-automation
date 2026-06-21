/**
 * AGENTE GERADOR DE CARDS
 * Renderiza JSX → PNG via @vercel/og (Satori) e envia como imagem no WhatsApp
 * com a análise completa na legenda (caption)
 * GET /api/cron/gerar-card?plano=vip|elite
 */
import { NextRequest, NextResponse } from "next/server";
import { ImageResponse } from "next/og";
import sharp from "sharp";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { gerarCardElement, getCardFonts } from "@/lib/card-generator";
import { gerarTexto } from "@/lib/ai";

const EVO_URL       = process.env.EVOLUTION_API_URL;
const EVO_KEY       = process.env.EVOLUTION_API_KEY;
const EVO_INST_VIP   = process.env.EVOLUTION_INSTANCIA       || "alertapatriota";
const EVO_INST_ELITE = process.env.EVOLUTION_INSTANCIA_ELITE  || "alertapatriota";

function getInstancia(plano: string): string {
  return plano === "elite" ? EVO_INST_ELITE : EVO_INST_VIP;
}

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
    agente: "gerador-card",
    max_tokens: 60,
    messages: [{ role: "user", content: `${PROMPTS_HOOK[plano]}\n\nNOTÍCIA: "${titulo}"` }],
  });
  return texto ? texto.replace(/["""]/g, "") : titulo;
}

// WhatsApp trava/não entrega caption de mídia acima de ~1024 caracteres — a mensagem
// fica presa em "carregando" para quem recebe mesmo com o upload da imagem OK.
// Corta no último espaço/quebra de linha antes do limite para não truncar no meio de uma palavra.
const LEGENDA_MAX = 990;
function truncarLegenda(texto: string): string {
  if (texto.length <= LEGENDA_MAX) return texto;
  const cortado = texto.slice(0, LEGENDA_MAX);
  const ultimaQuebra = Math.max(cortado.lastIndexOf("\n"), cortado.lastIndexOf(" "));
  return `${cortado.slice(0, ultimaQuebra > 0 ? ultimaQuebra : LEGENDA_MAX)}…`;
}

async function gerarLegenda(titulo: string, plano: string, fonte: string): Promise<string> {
  const hora = new Date().toLocaleTimeString("pt-BR", { hour:"2-digit", minute:"2-digit", timeZone:"America/Sao_Paulo" });
  const data = new Date().toLocaleDateString("pt-BR", { day:"numeric", month:"short", timeZone:"America/Sao_Paulo" });

  const corpo = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "gerador-card",
    max_tokens: 350,
    messages: [{ role: "user", content: `${PROMPTS_LEGENDA[plano]}\n\nNOTÍCIA: "${titulo}"\nFONTE: ${fonte}` }],
  });

  // Header formatado por grupo
  const headers: Record<string, string> = {
    vip:      `╔══════════════════╗\n║   🔥 VIP PREMIUM   ║\n╚══════════════════╝\n_${data} · ${hora} · ${fonte}_\n`,
    elite:    `╔══════════════════╗\n║  🎖️  ELITE GLOBAL  ║\n╚══════════════════╝\n*Prof. Dr. Bernardo Cavalcanti*\n_${data} · ${hora} · ${fonte}_\n`,
  };

  return truncarLegenda(`${headers[plano]}\n${corpo}`);
}

async function renderizarEEnviar(plano: string, hook: string, corpo: string | undefined, fonte: string, urgente: boolean | undefined, groupJid: string, legenda: string): Promise<{ ok: boolean; erro?: string }> {
  if (!EVO_URL || !EVO_KEY) return { ok: false, erro: "Evolution API não configurada (EVOLUTION_API_URL/EVOLUTION_API_KEY ausentes)" };

  // Renderiza JSX → PNG via @vercel/og (Satori) — sem Chromium, funciona em serverless
  const element = gerarCardElement({ plano: plano as "vip" | "elite", hook, corpo, fonte, urgente });
  const imagem = new ImageResponse(element, { width: 1080, height: 1080, fonts: getCardFonts() });
  const pngBuffer = Buffer.from(await imagem.arrayBuffer());

  if (!pngBuffer.length) return { ok: false, erro: "Falha ao renderizar PNG do card (@vercel/og retornou vazio)" };

  // Converte PNG (RGBA, ~1.5-1.7MB) para JPEG (sem canal alpha, muito mais leve) —
  // fotos reais enviadas no WhatsApp são quase sempre JPEG; PNG grande com alpha em
  // mensagens automatizadas é um padrão atípico que o pipeline de mídia trata com menos
  // confiabilidade, mesmo quando o upload é aceito (fica "carregando" para quem recebe).
  const jpegBuffer = await sharp(pngBuffer).flatten({ background: "#000000" }).jpeg({ quality: 90 }).toBuffer();
  const jpegBase64 = jpegBuffer.toString("base64");

  // Envia imagem com legenda via Evolution API
  const res = await fetch(`${EVO_URL}/message/sendMedia/${getInstancia(plano)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({
      number: groupJid,
      mediaMessage: {
        mediatype: "image",
        media: jpegBase64,
        caption: legenda,
        fileName: "alerta-patriota.jpg",
      },
    }),
  });

  if (!res.ok) {
    const corpoErro = await res.text().catch(() => "");
    return { ok: false, erro: `Evolution API ${res.status}: ${corpoErro.substring(0, 300)}` };
  }

  return { ok: true };
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
    // Garante colunas separadas para cards (idempotente)
    await sql`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS postada_vip_card BOOLEAN DEFAULT false`.catch(() => {});
    await sql`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS postada_elite_card BOOLEAN DEFAULT false`.catch(() => {});
    await sql`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS postada_vip_card_at TIMESTAMPTZ`.catch(() => {});
    await sql`ALTER TABLE noticias ADD COLUMN IF NOT EXISTS postada_elite_card_at TIMESTAMPTZ`.catch(() => {});

    // Busca notícias não publicadas como CARD (flag separada da publicação de texto).
    // Pega várias candidatas (não só LIMIT 1): se a mais nova falhar no envio, tenta as
    // seguintes na mesma execução em vez de travar a fila inteira nela indefinidamente.
    const rows = (plano === "vip"
      ? await sql`SELECT id, titulo, url, fonte, urgente, resumo_braga, resumo_cavalcanti FROM noticias WHERE postada_vip_card = false AND resumo_braga IS NOT NULL AND (global IS NULL OR global = false) ORDER BY urgente DESC, created_at DESC LIMIT 5`
      : await sql`SELECT id, titulo, url, fonte, urgente, resumo_braga, resumo_cavalcanti FROM noticias WHERE postada_elite_card = false AND resumo_cavalcanti IS NOT NULL ORDER BY urgente DESC, global DESC, created_at DESC LIMIT 5`) as unknown as {
      id: number; titulo: string; url: string | null; fonte: string | null; urgente: boolean | string; resumo_braga: string | null; resumo_cavalcanti: string | null;
    }[];

    if (!rows.length) return NextResponse.json({ ok: true, publicado: false, motivo: "sem notícia disponível" });

    let enviado = false;
    let hookFinal = "";
    let noticiaEnviada: typeof rows[number] | null = null;
    const erros: string[] = [];

    for (const n of rows) {
      const fonte = n.fonte || "Alerta Patriota";

      // Gera hook e legenda em paralelo
      const [hook, legenda] = await Promise.all([
        gerarHook(n.titulo, plano),
        gerarLegenda(n.titulo, plano, fonte),
      ]);

      // Renderiza e envia
      const urgente = n.urgente === true || n.urgente === "true";
      const resultado = await renderizarEEnviar(plano, hook, undefined, fonte, urgente, groupJid, legenda);

      if (resultado.ok) {
        enviado = true;
        hookFinal = hook;
        noticiaEnviada = n;

        // Marca como publicada como CARD (flag separada — não afeta publicar-noticias)
        if (plano === "vip")      await sql`UPDATE noticias SET postada_vip_card = true, postada_vip_card_at = NOW() WHERE id = ${n.id}`;
        if (plano === "elite")    await sql`UPDATE noticias SET postada_elite_card = true, postada_elite_card_at = NOW() WHERE id = ${n.id}`;

        // Log
        const grupoRow = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${plano} LIMIT 1`;
        if (grupoRow.length > 0) {
          await sql`INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status) VALUES (${grupoRow[0].id}, ${n.id}, ${legenda}, 'card_visual', 'enviado')`;
        }
        break;
      }

      erros.push(`#${n.id} ${n.titulo.substring(0, 40)}: ${resultado.erro}`);
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms) VALUES ('gerador-card', ${`card_${plano}`}, ${enviado ? "sucesso" : "erro"}, ${JSON.stringify({ plano, noticiaId: noticiaEnviada?.id, hook: hookFinal, tentativas: rows.length, erros })}, ${Date.now() - inicio})`;

    if (!enviado) {
      await alertarTelegram("🔴", `Falha Gerador Card (${plano})`, `Todas as ${rows.length} tentativas falharam:\n${erros.join("\n")}`);
    }

    return NextResponse.json({ ok: true, publicado: enviado, plano, hook: hookFinal, noticia: noticiaEnviada?.titulo, erros: enviado ? undefined : erros });
  } catch (err) {
    await alertarTelegram("🔴", `Falha Gerador Card (${plano})`, String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
