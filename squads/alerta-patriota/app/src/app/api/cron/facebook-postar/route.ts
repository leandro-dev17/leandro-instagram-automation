/**
 * AGENTE FACEBOOK POSTER — Capitão Braga
 * Posta na página do Facebook 3x/dia (manhã, tarde, noite).
 * Cada post é um teaser da notícia do dia com CTA para o grupo WhatsApp.
 * GET /api/cron/facebook-postar
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { publicarPostFacebook } from "@/lib/facebook";
import { alertarTelegram } from "@/lib/telegram";
import { gerarTexto } from "@/lib/ai";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

async function gerarTeaser(titulo: string, resumoBraga: string): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "facebook-poster",
    max_tokens: 300,
    messages: [{ role: "user", content: `Você é o Capitão Braga. Crie um post curto para o Facebook (3-4 linhas) baseado nesta notícia que vai DESPERTAR CURIOSIDADE e fazer a pessoa querer saber mais:

TÍTULO: "${titulo}"
RESUMO: "${resumoBraga?.substring(0, 200)}"

Regras:
- Comece com um gancho forte (pergunta ou afirmação impactante)
- NÃO revele o conteúdo completo — só provoque curiosidade
- No final diga "Veja a análise completa no grupo 👇"
- Tom patriótico e direto
- Máximo 4 linhas

Responda APENAS com o texto do post.` }],
  });
  return texto;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // Verifica se já postou hoje neste período
    const horaBRT = parseInt(
      new Date().toLocaleString("pt-BR", { hour: "numeric", timeZone: "America/Sao_Paulo" })
    );
    const periodo = horaBRT < 12 ? "manha" : horaBRT < 18 ? "tarde" : "noite";
    const jaPostou = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'facebook-poster' AND acao = ${`post_${periodo}`}
      AND created_at >= NOW() - INTERVAL '6 hours'
      LIMIT 1
    `;
    if (jaPostou.length > 0) return NextResponse.json({ ok: true, motivo: "já postou neste período" });

    // Busca notícia do dia com resumo do Capitão Braga
    const noticias = await sql`
      SELECT titulo, resumo_braga, url
      FROM noticias
      WHERE resumo_braga IS NOT NULL
      AND (global IS NULL OR global = false)
      AND created_at >= NOW() - INTERVAL '8 hours'
      ORDER BY urgente DESC, created_at DESC
      LIMIT 1
    `;

    if (!noticias.length) return NextResponse.json({ ok: true, motivo: "sem notícia disponível" });

    const n = noticias[0];
    const teaser = await gerarTeaser(n.titulo, n.resumo_braga);
    if (!teaser) return NextResponse.json({ ok: false, motivo: "teaser vazio" });

    // Monta post com CTA
    const postFb = `${teaser}\n\n🔗 Entre no grupo e receba análises assim todo dia:\n${APP_URL}/assinar\n\n#AlertaPatriota #Brasil #SemFiltro #DeusPátriaFamília`;

    const resultado = await publicarPostFacebook(postFb, n.url || APP_URL);

    if (resultado.erro) {
      await alertarTelegram("🟡", "Facebook Poster — Falha", resultado.erro);
      return NextResponse.json({ ok: false, erro: resultado.erro });
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('facebook-poster', ${`post_${periodo}`}, 'sucesso',
        ${JSON.stringify({ postId: resultado.id, titulo: n.titulo, chars: postFb.length })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, postId: resultado.id, periodo });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Facebook Poster", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
