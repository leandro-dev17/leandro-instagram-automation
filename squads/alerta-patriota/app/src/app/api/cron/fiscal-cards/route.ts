/**
 * FISCAL FLORA FOTO — Verifica geração e envio de cards visuais
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

const GRUPOS = ["basico", "patriota", "vip", "elite"] as const;

function horaBRT(): number {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  ).getHours();
}

async function chamarPublicar(grupo: string): Promise<boolean> {
  try {
    const res = await fetch(`${APP_URL}/api/cron/publicar-noticias?grupo=${grupo}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(30000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const agora = new Date();
  const resultado: Record<string, unknown> = {};
  const alertas: string[] = [];
  let autoFixTentado = false;

  try {
    // 1. Últimos registros do agente gerador-card nas últimas 4h
    const logsCards = await sql`
      SELECT status, created_at, detalhes
      FROM agentes_log
      WHERE agente = 'gerador-card'
        AND created_at > NOW() - INTERVAL '4 hours'
      ORDER BY created_at DESC
    `;

    const cardsSucesso = logsCards.filter((l) => l.status === "sucesso");
    const cardsErro = logsCards.filter((l) => l.status === "erro");
    const horaBrt = horaBRT();

    // 2. Sem card nas últimas 4h e já passou de 7h BRT
    if (cardsSucesso.length === 0 && horaBrt >= 7) {
      const msg = `Nenhum card enviado com sucesso nas últimas 4h (${horaBrt}h BRT)`;
      alertas.push(msg);

      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES ('cards_sem_envio', 'alto', ${msg})
      `;

      await alertarTelegram(
        "🚨",
        "FISCAL FLORA FOTO — ALERTA",
        `Grupos sem card nas últimas 4h: todos\nÚltima verificação: ${agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}\n\nAuto-fix sendo tentado...`
      );
    }

    // 3. Erros nas últimas 2h
    if (cardsErro.length > 0) {
      const detalheErro = cardsErro[0]?.detalhes ? JSON.stringify(cardsErro[0].detalhes) : "sem detalhes";
      const msg = `${cardsErro.length} erro(s) no gerador-card nas últimas 2h`;
      alertas.push(msg);

      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES ('cards_com_erro', 'alto', ${msg})
      `;

      await alertarTelegram(
        "🔴",
        "FISCAL FLORA FOTO — Erros no gerador de cards",
        `${cardsErro.length} erro(s) detectados\nDetalhe: ${detalheErro}`
      );
    }

    // 4. Grupos sem publicação há mais de 8h
    const gruposSemPost: string[] = [];

    for (const grupo of GRUPOS) {
      const ultimoPost = await sql`
        SELECT enviado_at
        FROM posts_whatsapp pw
        JOIN grupos_whatsapp g ON g.id = pw.grupo_id
        WHERE g.plano = ${grupo}
          AND pw.status = 'enviado'
        ORDER BY pw.enviado_at DESC
        LIMIT 1
      `;

      if (ultimoPost.length === 0) {
        gruposSemPost.push(grupo);
        continue;
      }

      const ultimoAt = new Date(ultimoPost[0].enviado_at as string);
      const diffHoras = (agora.getTime() - ultimoAt.getTime()) / 1000 / 3600;

      if (diffHoras > 8) {
        gruposSemPost.push(grupo);
      }

      resultado[`grupo_${grupo}`] = {
        ultimo_post: ultimoAt.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }),
        horas_sem_post: Math.round(diffHoras),
        ok: diffHoras <= 8,
      };
    }

    if (gruposSemPost.length > 0) {
      alertas.push(`Grupos sem publicação há +8h: ${gruposSemPost.join(", ")}`);
    }

    // 5. Auto-fix: notícias prontas mas não publicadas
    async function noticiasDisponiveisPorGrupo(grupo: string) {
      if (grupo === "basico")
        return sql`SELECT id FROM noticias WHERE resumo_braga IS NOT NULL AND postada_basico = false AND created_at > NOW() - INTERVAL '8 hours' LIMIT 1`;
      if (grupo === "patriota")
        return sql`SELECT id FROM noticias WHERE resumo_braga IS NOT NULL AND postada_patriota = false AND created_at > NOW() - INTERVAL '8 hours' LIMIT 1`;
      if (grupo === "vip")
        return sql`SELECT id FROM noticias WHERE resumo_braga IS NOT NULL AND postada_vip = false AND created_at > NOW() - INTERVAL '8 hours' LIMIT 1`;
      return sql`SELECT id FROM noticias WHERE resumo_braga IS NOT NULL AND postada_elite = false AND created_at > NOW() - INTERVAL '8 hours' LIMIT 1`;
    }

    for (const grupo of GRUPOS) {
      if (!gruposSemPost.includes(grupo)) continue;

      const noticias = await noticiasDisponiveisPorGrupo(grupo);

      if (noticias.length > 0) {
        autoFixTentado = true;
        const ok = await chamarPublicar(grupo);

        await sql`
          INSERT INTO agentes_log (agente, acao, status, detalhes)
          VALUES (
            'flora-foto',
            'auto_fix_publicar',
            ${ok ? "sucesso" : "erro"},
            ${JSON.stringify({ grupo, noticias_disponiveis: noticias.length })}
          )
        `;
      }
    }

    // 6. Alerta resumido com auto-fix
    if (alertas.length > 0 && autoFixTentado) {
      const horaBrtStr = agora.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" });
      await alertarTelegram(
        "🚨",
        "FISCAL FLORA FOTO — ALERTA",
        `Grupos sem card nas últimas 4h: ${gruposSemPost.join(", ") || "nenhum"}\nÚltimo card: ${horaBrtStr}\n\nAuto-fix tentado: ✅ re-publicação acionada\n📋 Ver alertas: alertapatriota.vercel.app/admin`
      );
    }

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'flora-foto',
        'verificar_cards',
        ${alertas.length > 0 ? "aviso" : "sucesso"},
        ${JSON.stringify({ alertas, grupos_sem_post: gruposSemPost, auto_fix_tentado: autoFixTentado })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: alertas.length === 0,
      alertas,
      grupos_sem_post: gruposSemPost,
      cards_sucesso_4h: cardsSucesso.length,
      cards_erro_4h: cardsErro.length,
      auto_fix_tentado: autoFixTentado,
      grupos: resultado,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "FISCAL FLORA FOTO — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
