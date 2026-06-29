/**
 * FISCAL CLARA CONTEÚDO — Valida qualidade política das notícias publicadas
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const PALAVRAS_PROIBIDAS = [
  "lipogênese",
  "oncologia",
  "farmacêutica não quer",
  "gordura que",
  "dieta",
  "nutrição",
  "alimento saudável",
  "suplemento",
  "vitamina",
  "câncer de",
  "saúde e bem-estar",
  "receita de",
  "culinária",
  "moda e beleza",
  "horóscopo",
  "astrologia",
  "futebol",
  "campeonato",
  "gol",
  "atleta",
  "reality",
  "bbb",
  "cinema",
  "série",
  "streaming",
  "netflix",
  "pagode",
  "funk",
  "sertanejo",
  "motociclista",
  "acidente na",
  "batida na",
  "morte no trânsito",
  "grande otelo",
  "grammy",
  "oscar",
  "indicados ao prêmio",
  "festival de cinema",
];

// Item 6 (Fase 33): `.includes()` puro casava substring dentro de palavras não relacionadas —
// o caso mais grave era "gol" (item da lista, contexto futebol) dando match em "golpe", termo
// político central ("golpe militar", "ameaça de golpe") que este fiscal existe para NÃO filtrar.
// Lookaround de letra (incluindo acentuadas) simula \b sem depender da flag `u`/\p{L}.
const LETRA = "a-zà-úA-ZÀ-Ú";
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function contemPalavraProibida(texto: string): string | null {
  const lower = texto.toLowerCase();
  for (const p of PALAVRAS_PROIBIDAS) {
    const regex = new RegExp(`(?<![${LETRA}])${escapeRegex(p)}(?![${LETRA}])`, "i");
    if (regex.test(lower)) return p;
  }
  return null;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const postsInvalidos: Array<Record<string, unknown>> = [];
  const noticiasInvalidas: Array<Record<string, unknown>> = [];

  try {
    // 1. Últimas 10 publicações no WhatsApp nas últimas 24h
    const posts = await sql`
      SELECT pw.id, pw.conteudo, pw.tipo, pw.enviado_at, g.nome AS grupo_nome, g.plano
      FROM posts_whatsapp pw
      JOIN grupos_whatsapp g ON g.id = pw.grupo_id
      WHERE pw.enviado_at > NOW() - INTERVAL '24 hours'
        AND pw.status = 'enviado'
      ORDER BY pw.enviado_at DESC
      LIMIT 10
    `;

    for (const post of posts) {
      const palavra = contemPalavraProibida(String(post.conteudo));
      if (palavra) {
        postsInvalidos.push({
          id: post.id,
          grupo: post.grupo_nome,
          plano: post.plano,
          tipo: post.tipo,
          enviado_at: post.enviado_at,
          palavra_encontrada: palavra,
          preview: String(post.conteudo).slice(0, 120),
        });
      }
    }

    // 2. Notícias marcadas como postadas nas últimas 24h com palavras proibidas no título
    const noticias = await sql`
      SELECT id, titulo, fonte, categoria, created_at
      FROM noticias
      WHERE (postada_vip = true OR postada_elite = true)
        AND created_at > NOW() - INTERVAL '24 hours'
    `;

    for (const noticia of noticias) {
      const palavra = contemPalavraProibida(String(noticia.titulo));
      if (palavra) {
        noticiasInvalidas.push({
          id: noticia.id,
          titulo: noticia.titulo,
          fonte: noticia.fonte,
          categoria: noticia.categoria,
          created_at: noticia.created_at,
          palavra_encontrada: palavra,
        });
      }
    }

    const totalInvalidos = postsInvalidos.length + noticiasInvalidas.length;

    if (totalInvalidos > 0) {
      const exemplos = [
        ...postsInvalidos.map((p) => `Post (${p.grupo}): "${p.palavra_encontrada}"`),
        ...noticiasInvalidas.map((n) => `Notícia: "${n.titulo}"`),
      ]
        .slice(0, 5)
        .join("\n");

      const { criado } = await criarAlertaDedup(
        "conteudo_irrelevante",
        "alto",
        `${totalInvalidos} item(s) com conteúdo não-político detectado(s) nas últimas 24h`
      );

      if (criado) {
        await alertarTelegram(
          "🔴",
          "FISCAL CLARA CONTEÚDO — Conteúdo Inadequado Detectado",
          `${postsInvalidos.length} post(s) e ${noticiasInvalidas.length} notícia(s) com conteúdo não-político\n\nExemplos:\n${exemplos}\n\n📋 Revisar: alertapatriota.vercel.app/admin`
        );
      }
    }

    const postsValidos = posts.length - postsInvalidos.length;
    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'clara-conteudo',
        'verificar_qualidade',
        ${totalInvalidos > 0 ? "aviso" : "sucesso"},
        ${JSON.stringify({
          posts_verificados: posts.length,
          posts_validos: postsValidos,
          posts_invalidos: postsInvalidos.length,
          noticias_invalidas: noticiasInvalidas.length,
        })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: totalInvalidos === 0,
      posts_verificados: posts.length,
      posts_validos: postsValidos,
      posts_invalidos: postsInvalidos.length,
      noticias_invalidas: noticiasInvalidas.length,
      detalhes_invalidos: postsInvalidos,
      detalhes_noticias: noticiasInvalidas,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "FISCAL CLARA CONTEÚDO — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
