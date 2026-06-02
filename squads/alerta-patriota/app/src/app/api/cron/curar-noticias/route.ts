/**
 * AGENTE CURADOR CARLOS + ANA ANTI-DUPLICATA
 * Seleciona as melhores notícias do lote coletado e marca duplicatas.
 * Usa Claude para classificar relevância e impacto político.
 * GET /api/cron/curar-noticias
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// FIX 3: Temas que ressoam com o público conservador
const TEMAS_RELEVANTES = [
  "STF", "Supremo", "Lula", "governo federal", "imposto", "tribut",
  "armamento", "aborto", "família", "educação sexual", "ideologia",
  "Venezuela", "Cuba", "comunismo", "marxismo", "censura", "liberdade",
  "Congresso", "Câmara", "Senado", "votação", "PL", "projeto de lei",
  "corrupção", "desvio", "esquema", "fraude", "lavagem",
  "segurança pública", "crime", "violência", "fronteira",
  "economia", "inflação", "desemprego", "salário",
  "soberania", "BRICS", "China", "Argentina", "Milei",
  "Bolsonaro", "Nikolas", "deputado", "senador", "ministro",
  "eleição", "política", "partido", "direita", "conservador",
];

// Temas de esporte/entretenimento/celebridade que devem ser IGNORADOS
const TEMAS_EXCLUIR = [
  // Esportes
  "copa do mundo", "futebol", "campeonato", "seleção brasileira", "gol",
  "jogador", "técnico", "treino", "partida", "jogo", "esporte",
  "odds", "zebra", "apostas esportivas", "torneio", "atleta",
  "olimpíada", "paraolimpíada", "mundial de", "nba", "nfl",
  // Celebridades e saúde de famosos
  "celebridade", "famoso", "artista", "ator", "atriz", "show",
  "entretenimento", "novela", "música", "cantor", "moda",
  "vai parar no hospital", "internado", "internada", "quadro de saúde",
  "fontenelle", "xuxa", "faustão", "gkay", "virgínia", "influencer",
  "casamento de", "divórcio de", "separação de", "romance de",
  // Reality / streaming / cinema
  "reality", "bbb", "big brother", "the voice", "masterchef",
  "cinema", "série", "streaming", "netflix", "globoplay", "amazon prime",
  "disney plus", "hbo max", "apple tv",
  // Prêmios de entretenimento
  "grande otelo", "grammy", "oscar", "emmy", "globo de ouro",
  "melhores do ano", "indicados ao prêmio", "vencedor do prêmio",
  "festival de cinema", "festival de música",
  // Música de entretenimento
  "pagode", "funk", "sertanejo", "forró", "axé",
  // Trânsito / acidente / polícia (sem contexto político)
  "motociclista", "acidente na", "engavetamento", "batida na",
  "morte no trânsito", "atropelamento",
  // Outros irrelevantes
  "receita de", "saúde e bem-estar", "dieta", "emagrecimento",
  "horóscopo", "astrologia", "moda e beleza",
];

function ehEsporteOuEntretenimento(titulo: string): boolean {
  const tituloLower = titulo.toLowerCase();
  return TEMAS_EXCLUIR.some(t => tituloLower.includes(t));
}

function calcularRelevancia(titulo: string): number {
  const tituloLower = titulo.toLowerCase();
  let score = 0;
  for (const tema of TEMAS_RELEVANTES) {
    if (tituloLower.includes(tema.toLowerCase())) score += 10;
  }
  // Bônus para notícias urgentes
  if (/urgente|breaking|exclusivo|alerta/i.test(titulo)) score += 20;
  return Math.min(score, 100);
}

async function classificarComClaude(noticias: Array<{ id: number; titulo: string }>): Promise<number[]> {
  if (noticias.length === 0) return [];

  try {
    const lista = noticias.map((n, i) => `${i + 1}. ${n.titulo}`).join("\n");

    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      messages: [{
        role: "user",
        content: `Você é um curador de notícias para um público conservador e patriota brasileiro.
Das notícias abaixo, selecione os números das 3 mais relevantes e impactantes para esse público.
Priorize: STF, governo Lula, impostos, família, segurança, corrupção, soberania.
Responda APENAS com os números separados por vírgula. Ex: 2,5,7

${lista}`,
      }],
    });

    const resposta = msg.content[0].type === "text" ? msg.content[0].text : "";
    const indices = resposta.match(/\d+/g)?.map(Number).filter(n => n >= 1 && n <= noticias.length) || [];
    return indices.map(i => noticias[i - 1].id);
  } catch {
    // Fallback: usa score local
    return noticias.slice(0, 3).map(n => n.id);
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();

  try {
    // Busca notícias coletadas nas últimas 8h sem resumo ainda
    const novas = await sql`
      SELECT id, titulo, url
      FROM noticias
      WHERE resumo_braga IS NULL
        AND global = false
        AND created_at >= NOW() - INTERVAL '8 hours'
      ORDER BY created_at DESC
      LIMIT 20
    `;

    if (novas.length === 0) {
      return NextResponse.json({ ok: true, curadas: 0, motivo: "sem notícias novas" });
    }

    // FIX 3: Remove esporte e entretenimento primeiro
    const semEsporte = novas.filter((n: { titulo: string }) => !ehEsporteOuEntretenimento(n.titulo));

    // Anti-duplicata: remove títulos muito similares (mesmo tema)
    const unicas: typeof novas = [];
    const titulosVistos: string[] = [];
    const novas2 = semEsporte;

    for (const n of novas2) {
      const palavrasChave = n.titulo.toLowerCase().split(" ").filter((p: string) => p.length > 4).slice(0, 5).join(" ");
      const jaTem = titulosVistos.some(t => {
        const palavras = palavrasChave.split(" ");
        return palavras.filter(p => t.includes(p)).length >= 3;
      });

      if (!jaTem) {
        unicas.push(n);
        titulosVistos.push(palavrasChave);
      }
    }

    // Pontua por relevância local
    const pontuadas = unicas
      .map(n => ({ ...n, score: calcularRelevancia(n.titulo) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    // Claude seleciona as top 3
    const selecionadas = await classificarComClaude(pontuadas);

    // Marca as selecionadas como urgentes (flag para o resumidor priorizar)
    if (selecionadas.length > 0) {
      for (const id of selecionadas) {
        await sql`UPDATE noticias SET categoria = 'curada' WHERE id = ${id}`;
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('curador-carlos', 'curar_noticias', 'sucesso',
        ${JSON.stringify({ total: novas.length, unicas: unicas.length, selecionadas: selecionadas.length })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, total: novas.length, unicas: unicas.length, selecionadas: selecionadas.length });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Curador Carlos", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
