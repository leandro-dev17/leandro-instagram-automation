/**
 * AGENTE PAULO VIP / PAULO ELITE
 * Cron job de publicação de notícias nos grupos WhatsApp.
 * Executa 3x/dia: 7h, 13h, 19h (via Vercel Cron ou chamada externa).
 *
 * GET /api/cron/publicar-noticias?grupo=vip|elite
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import type { Plano } from "@/lib/db";


function buildMensagemNoticia(plano: Plano, noticia: {
  titulo: string;
  fonte: string | null;
  resumo_braga: string | null;
  resumo_cavalcanti: string | null;
  urgente: boolean;
}): string {
  const resumo = plano === "elite" ? noticia.resumo_cavalcanti : noticia.resumo_braga;
  if (!resumo) return "";

  const hora = new Date().toLocaleTimeString("pt-BR", {
    hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo",
  });
  const periodo = getPeriodo();

  // Cabeçalho por grupo
  const cabecalhos: Record<Plano, string> = {
    vip:      `🔥 *VIP PREMIUM — ${periodo.toUpperCase()} | ${hora}*`,
    elite:    `🎖️ *ELITE GLOBAL — ${periodo.toUpperCase()} | ${hora}*`,
  };

  // Fonte citada como texto — SEM link
  const fonteTexto = noticia.fonte ? `\n_Fonte: ${noticia.fonte}_` : "";

  // Assinatura por persona
  const assinatura = plano === "elite"
    ? `\n\n*— Prof. Dr. Bernardo Cavalcanti*\n_O mundo muda para quem enxerga antes._`
    : `\n\n*— Capitão Roberto Braga*\n_Deus, Pátria e Família — sempre._`;

  return `${cabecalhos[plano]}\n\n${resumo}${fonteTexto}${assinatura}`;
}

function getPeriodo(): string {
  const horaBRT = parseInt(
    new Date().toLocaleString("pt-BR", { hour: "numeric", timeZone: "America/Sao_Paulo" })
  );
  if (horaBRT < 12) return "Manhã";
  if (horaBRT < 18) return "Tarde";
  return "Noite";
}

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const grupo = (searchParams.get("grupo") || "vip") as Plano;

  if (!["vip", "elite"].includes(grupo)) {
    return NextResponse.json({ erro: "Grupo inválido" }, { status: 400 });
  }

  // Item 25 (Fase 30): noticia_id era recebido mas nunca usado — "Publicar agora"
  // de uma notícia específica acabava publicando qualquer outra que estivesse no
  // topo da fila daquele grupo. Quando informado, restringe a seleção a essa
  // notícia (COALESCE faz o filtro virar no-op quando não informado, preservando
  // o comportamento original do cron agendado).
  const noticiaIdParam = searchParams.get("noticia_id");
  const noticiaId = noticiaIdParam && /^\d+$/.test(noticiaIdParam) ? parseInt(noticiaIdParam, 10) : null;

  const inicio = Date.now();

  try {
    // FASE 17: antes era um SELECT seguido de UPDATE separado — duas chamadas
    // concorrentes (ex.: cron agendado + "publicar agora" do admin) podiam
    // selecionar a mesma notícia antes que a primeira marcasse postada_x=true,
    // publicando-a duas vezes. Agora a seleção e a marcação são uma única
    // operação atômica (CTE + FOR UPDATE SKIP LOCKED), que já reserva a
    // notícia antes de qualquer envio.
    const rows = (grupo === "vip"
      ? await sql`
          WITH proxima AS (
            SELECT id FROM noticias
            WHERE postada_vip = false AND resumo_braga IS NOT NULL AND (global IS NULL OR global = false)
              AND id = COALESCE(${noticiaId}, id)
            ORDER BY urgente DESC, created_at DESC LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE noticias SET postada_vip = true, postada_vip_at = NOW()
          WHERE id IN (SELECT id FROM proxima)
          RETURNING id, titulo, fonte, url, urgente, resumo_braga, resumo_cavalcanti
        `
      // Elite: aceita notícias BR e globais, desde que tenha resumo_cavalcanti
      : await sql`
          WITH proxima AS (
            SELECT id FROM noticias
            WHERE postada_elite = false AND resumo_cavalcanti IS NOT NULL
              AND id = COALESCE(${noticiaId}, id)
            ORDER BY urgente DESC, global DESC, created_at DESC LIMIT 1
            FOR UPDATE SKIP LOCKED
          )
          UPDATE noticias SET postada_elite = true, postada_elite_at = NOW()
          WHERE id IN (SELECT id FROM proxima)
          RETURNING id, titulo, fonte, url, urgente, resumo_braga, resumo_cavalcanti
        `) as unknown as {
      id: number;
      titulo: string;
      fonte: string | null;
      url: string | null;
      urgente: boolean;
      resumo_braga: string | null;
      resumo_cavalcanti: string | null;
    }[];

    if (rows.length === 0) {
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
        VALUES (${`paulo-${grupo}`}, 'publicar_noticia', 'aviso',
          '{"motivo": "nenhuma noticia disponivel"}', ${Date.now() - inicio})
      `;
      return NextResponse.json({ ok: true, publicado: false, motivo: "sem notícia disponível" });
    }

    const noticia = rows[0];
    const mensagem = buildMensagemNoticia(grupo, noticia);

    if (!mensagem) {
      // Notícia já foi reservada pelo UPDATE atômico acima, mas não há resumo
      // utilizável — libera para não perder a notícia permanentemente.
      if (grupo === "vip") {
        await sql`UPDATE noticias SET postada_vip = false, postada_vip_at = NULL WHERE id = ${noticia.id}`;
      } else {
        await sql`UPDATE noticias SET postada_elite = false, postada_elite_at = NULL WHERE id = ${noticia.id}`;
      }
      return NextResponse.json({ ok: true, publicado: false, motivo: "resumo vazio" });
    }

    // Envia para o grupo (a notícia já foi marcada como postada de forma
    // atômica na consulta acima, evitando que outra chamada concorrente a
    // selecione novamente)
    const enviado = await enviarMensagemGrupo(grupo, mensagem);

    if (enviado) {
      // Registra post
      const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${grupo} LIMIT 1`;
      if (grupoRows.length > 0) {
        await sql`
          INSERT INTO posts_whatsapp (grupo_id, noticia_id, conteudo, tipo, status)
          VALUES (${grupoRows[0].id}, ${noticia.id}, ${mensagem}, 'noticia', 'enviado')
        `;
      }
    } else {
      // Envio falhou — libera a notícia para tentar de novo na próxima execução
      if (grupo === "vip") {
        await sql`UPDATE noticias SET postada_vip = false, postada_vip_at = NULL WHERE id = ${noticia.id}`;
      } else {
        await sql`UPDATE noticias SET postada_elite = false, postada_elite_at = NULL WHERE id = ${noticia.id}`;
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (${`paulo-${grupo}`}, 'publicar_noticia', ${enviado ? "sucesso" : "erro"},
        ${JSON.stringify({ noticiaId: noticia.id, titulo: noticia.titulo, enviado })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, publicado: enviado, noticia: noticia.titulo });
  } catch (err) {
    console.error(`publicar-noticias (${grupo}) error:`, err);
    await alertarTelegram("🔴", `Falha no Agente Paulo ${grupo}`, String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES (${`paulo-${grupo}`}, 'publicar_noticia', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
