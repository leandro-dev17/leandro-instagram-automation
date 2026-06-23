import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram, alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const FONTES = [
  { nome: "Jovem Pan", url: "https://jovempan.com.br/feed/" },
  { nome: "Revista Oeste", url: "https://revistaoeste.com/feed/" },
  { nome: "Gazeta do Povo", url: "https://www.gazetadopovo.com.br/rss/politica.xml" },
  { nome: "O Antagonista", url: "https://www.oantagonista.com/feed/" },
  { nome: "Terça Livre", url: "https://tercalivre.com.br/feed/" },
  { nome: "CNN Brasil Pol.", url: "https://www.cnnbrasil.com.br/politica/feed/" },
];

const LIMITE_HORAS_INATIVIDADE = 4;

type StatusFonte = {
  nome: string;
  url: string;
  ultima_noticia_em: string | null;
  horas_sem_noticia: number | null;
  feed_respondeu: boolean | null;
  feed_status: number | null;
  falhas_consecutivas: number;
  estado: "ok" | "aviso" | "down";
};

async function buscarUltimaNoticia(nomeFonte: string): Promise<Date | null> {
  const rows = await sql`
    SELECT created_at FROM noticias
    WHERE fonte ILIKE ${"%" + nomeFonte + "%"}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  if (rows.length === 0) return null;
  return new Date(rows[0].created_at as string);
}

async function testarFeed(url: string): Promise<{ ok: boolean; status: number | null }> {
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; AlertaPatriota/1.0)" },
      signal: AbortSignal.timeout(8000),
    });
    return { ok: res.ok, status: res.status };
  } catch {
    return { ok: false, status: null };
  }
}

async function buscarFalhasConsecutivas(nomeFonte: string): Promise<number> {
  const rows = await sql`
    SELECT status FROM agentes_log
    WHERE agente = 'roberto-rss'
      AND detalhes->>'fonte' = ${nomeFonte}
    ORDER BY created_at DESC
    LIMIT 5
  `;

  let consecutivas = 0;
  for (const row of rows) {
    if (row.status === "erro" || row.status === "aviso") {
      consecutivas++;
    } else {
      break;
    }
  }
  return consecutivas;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const agora = new Date();
  const resultados: StatusFonte[] = [];
  const fontesDown: string[] = [];
  const alertasCriticos: string[] = [];
  let algumAlertaCriado = false;

  try {
    for (const fonte of FONTES) {
      const ultimaNoticia = await buscarUltimaNoticia(fonte.nome);
      let horasSemNoticia: number | null = null;
      let feedRespondeu: boolean | null = null;
      let feedStatus: number | null = null;
      let estado: "ok" | "aviso" | "down" = "ok";

      if (ultimaNoticia) {
        horasSemNoticia = (agora.getTime() - ultimaNoticia.getTime()) / (1000 * 60 * 60);
      } else {
        horasSemNoticia = 999;
      }

      const precisaTestarFeed = horasSemNoticia > LIMITE_HORAS_INATIVIDADE;

      if (precisaTestarFeed) {
        const resultado = await testarFeed(fonte.url);
        feedRespondeu = resultado.ok;
        feedStatus = resultado.status;

        if (!feedRespondeu) {
          estado = "down";
          fontesDown.push(fonte.nome);
        } else {
          estado = "aviso";
        }
      }

      const falhasConsecutivas = await buscarFalhasConsecutivas(fonte.nome);
      const falhasAtualizado = estado !== "ok" ? falhasConsecutivas + 1 : 0;

      const statusLog: "sucesso" | "erro" | "aviso" =
        estado === "down" ? "erro" : estado === "aviso" ? "aviso" : "sucesso";

      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
        VALUES (
          'roberto-rss',
          ${"verificar_fonte_" + fonte.nome.toLowerCase().replace(/\s+/g, "_")},
          ${statusLog},
          ${JSON.stringify({
            fonte: fonte.nome,
            url: fonte.url,
            ultima_noticia: ultimaNoticia?.toISOString() || null,
            horas_sem_noticia: horasSemNoticia,
            feed_respondeu: feedRespondeu,
            feed_status: feedStatus,
            estado,
          })},
          ${Date.now() - inicio}
        )
      `;

      if (falhasAtualizado >= 2 && estado !== "ok") {
        const mensagemCritica = `Fonte ${fonte.nome} com ${falhasAtualizado} falhas consecutivas. Feed ${feedRespondeu ? "responde mas sem conteúdo novo" : "não responde (status " + feedStatus + ")"}. Última notícia: ${ultimaNoticia ? ultimaNoticia.toLocaleString("pt-BR") : "nunca"}`;
        alertasCriticos.push(mensagemCritica);

        const { criado } = await criarAlertaDedup("fonte_rss_down", "critico", mensagemCritica);
        if (criado) algumAlertaCriado = true;
      }

      resultados.push({
        nome: fonte.nome,
        url: fonte.url,
        ultima_noticia_em: ultimaNoticia?.toISOString() || null,
        horas_sem_noticia: horasSemNoticia !== null ? Math.round(horasSemNoticia * 10) / 10 : null,
        feed_respondeu: feedRespondeu,
        feed_status: feedStatus,
        falhas_consecutivas: falhasAtualizado,
        estado,
      });
    }

    if (alertasCriticos.length > 0 && algumAlertaCriado) {
      const fontesCriticasLista = resultados
        .filter((f) => f.estado !== "ok")
        .map((f) => `• ${f.nome}: ${f.estado === "down" ? "DOWN" : "sem conteúdo"} (${f.horas_sem_noticia}h)`)
        .join("\n");

      const msg = [
        `🔴 ROBERTO RSS — Fontes com Problema`,
        ``,
        fontesCriticasLista,
        ``,
        `Fontes críticas (2+ falhas): ${alertasCriticos.length}`,
      ].join("\n");

      await enviarTelegram(msg);
    } else if (alertasCriticos.length === 0 && fontesDown.length > 0) {
      const msg = [
        `🟡 ROBERTO RSS — Fontes Lentas`,
        fontesDown.map((f) => `• ${f}: sem notícias recentes`).join("\n"),
      ].join("\n");
      await enviarTelegram(msg);
    }

    const duracao = Date.now() - inicio;
    const tudoOk = fontesDown.length === 0 && alertasCriticos.length === 0;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'roberto-rss',
        'verificar_todas_fontes',
        ${tudoOk ? "sucesso" : alertasCriticos.length > 0 ? "erro" : "aviso"},
        ${JSON.stringify({ total_fontes: FONTES.length, fontes_down: fontesDown, alertas_criticos: alertasCriticos.length })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: tudoOk,
      fontes: resultados,
      fontes_down: fontesDown,
      alertas_criticos: alertasCriticos.length,
      duracao_ms: duracao,
    });
  } catch (err) {
    const duracao = Date.now() - inicio;
    await alertarTelegram("🚨", "ROBERTO RSS — ERRO CRÍTICO", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('roberto-rss', 'verificar_todas_fontes', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
