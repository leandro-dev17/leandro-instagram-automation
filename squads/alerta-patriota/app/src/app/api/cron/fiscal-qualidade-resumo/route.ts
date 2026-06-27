/**
 * VITOR VALIDADOR — Fiscal de qualidade dos resumos gerados pelo Claude
 * Verifica as últimas 10 notícias e invalida resumos com problemas.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const PALAVRAS_INGLESAS = [
  "the", "and", "for", "that", "this", "with", "from", "have", "will",
  "been", "they", "their", "about", "would", "there", "which", "what",
  "when", "more", "also", "than", "your", "can", "but", "are", "not",
];

interface ProblemaResumo {
  noticiaId: number;
  campo: "resumo_braga" | "resumo_cavalcanti";
  motivo: string;
}

function temPlaceholder(texto: string): boolean {
  return /Lorem|TODO|\[|^\s*\.{3}\s*$/.test(texto);
}

function temIdiomaSuspeito(texto: string): boolean {
  const palavras = texto.toLowerCase().split(/\s+/);
  if (palavras.length === 0) return false;
  const inglesas = palavras.filter(p => PALAVRAS_INGLESAS.includes(p)).length;
  return inglesas / palavras.length >= 0.2;
}

function validarResumoBraga(texto: string): string | null {
  if (texto.length < 100) return "muito curto (" + texto.length + " chars)";
  if (temPlaceholder(texto)) return "contém placeholder inválido";
  if (temIdiomaSuspeito(texto)) return "possível texto em inglês detectado";
  if (!/Deus, Pátria|sempre/i.test(texto)) return "sem assinatura esperada";
  return null;
}

function validarResumoCavalcanti(texto: string): string | null {
  if (texto.length < 100) return "muito curto (" + texto.length + " chars)";
  if (temPlaceholder(texto)) return "contém placeholder inválido";
  if (temIdiomaSuspeito(texto)) return "possível texto em inglês detectado";
  // resumo_cavalcanti é preenchido por DUAS personas com assinaturas diferentes:
  // PROMPT_CAVALCANTI (resumir-noticias, a maioria dos casos) termina com "Análise do
  // Prof. Cavalcanti.", e PROMPT_CAVALCANTI_GLOBAL (resumir-noticias-global) termina com
  // "O mundo muda para quem enxerga antes." — só validar a segunda apagava como "inválido"
  // todo resumo bom gerado pela persona normal (lib/personas.ts).
  if (!/Análise do Prof\.?\s*Cavalcanti|mundo muda|enxerga antes/i.test(texto)) return "sem assinatura esperada";
  return null;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    const noticias = await sql`
      SELECT id, titulo, resumo_braga, resumo_cavalcanti
      FROM noticias
      WHERE (resumo_braga IS NOT NULL OR resumo_cavalcanti IS NOT NULL)
        AND created_at >= NOW() - INTERVAL '4 hours'
      ORDER BY created_at DESC
      LIMIT 10
    ` as { id: number; titulo: string; resumo_braga: string | null; resumo_cavalcanti: string | null }[];

    const problemas: ProblemaResumo[] = [];
    const idsParaLimparBraga: number[] = [];
    const idsParaLimparCavalcanti: number[] = [];

    for (const noticia of noticias) {
      if (noticia.resumo_braga) {
        const erro = validarResumoBraga(noticia.resumo_braga);
        if (erro) {
          problemas.push({ noticiaId: noticia.id, campo: "resumo_braga", motivo: erro });
          idsParaLimparBraga.push(noticia.id);
        }
      }

      if (noticia.resumo_cavalcanti) {
        const erro = validarResumoCavalcanti(noticia.resumo_cavalcanti);
        if (erro) {
          problemas.push({ noticiaId: noticia.id, campo: "resumo_cavalcanti", motivo: erro });
          idsParaLimparCavalcanti.push(noticia.id);
        }
      }
    }

    for (const id of idsParaLimparBraga) {
      await sql`UPDATE noticias SET resumo_braga = NULL WHERE id = ${id}`;
    }

    for (const id of idsParaLimparCavalcanti) {
      await sql`UPDATE noticias SET resumo_cavalcanti = NULL WHERE id = ${id}`;
    }

    if (problemas.length > 3) {
      const linhas = problemas
        .map(p => `• Notícia #${p.noticiaId}: ${p.campo === "resumo_braga" ? "resumo_braga" : "resumo_cavalcanti"} ${p.motivo}`)
        .join("\n");

      const alerta =
        `⚠️ <b>VITOR VALIDADOR — Qualidade de Resumos</b>\n` +
        `${problemas.length} resumos com problemas encontrados:\n\n` +
        linhas + "\n\n" +
        `Ação: notícias marcadas para regeneração automática.\n` +
        `O Bernardo Resumidor irá reprocessar no próximo ciclo.`;

      const { criado } = await criarAlertaDedup(
        "vitor-validador",
        "alto",
        `${problemas.length} resumos inválidos detectados e marcados para regeneração.`
      );

      if (criado) {
        await enviarTelegram(alerta);
      }
    }

    const duracao_ms = Date.now() - inicio;

    const statusLog = problemas.length === 0 ? "sucesso" : problemas.length > 3 ? "aviso" : "sucesso";
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'vitor-validador',
        'verificar_qualidade_resumos',
        ${statusLog},
        ${JSON.stringify({
          noticias_analisadas: noticias.length,
          problemas_encontrados: problemas.length,
          braga_limpos: idsParaLimparBraga.length,
          cavalcanti_limpos: idsParaLimparCavalcanti.length,
          detalhes: problemas,
        })},
        ${duracao_ms}
      )
    `;

    return NextResponse.json({
      ok: true,
      noticias_analisadas: noticias.length,
      problemas_encontrados: problemas.length,
      braga_marcados_regeneracao: idsParaLimparBraga.length,
      cavalcanti_marcados_regeneracao: idsParaLimparCavalcanti.length,
      problemas,
      duracao_ms,
    });
  } catch (err) {
    const duracao_ms = Date.now() - inicio;
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('vitor-validador', 'verificar_qualidade_resumos', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao_ms})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
