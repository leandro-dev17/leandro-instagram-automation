/**
 * AGENTE ANÁLISE SEMANAL VIP — Capitão Braga
 * Toda segunda-feira: "Semana em Perspectiva" para o grupo VIP Premium.
 * GET /api/cron/analise-semanal-vip
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import { gerarTexto } from "@/lib/ai";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

function ehSegundaFeiraBRT(): boolean {
  const agora = new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" });
  return new Date(agora).getDay() === 1;
}

function dataSemanaBRT(): string {
  return new Date().toLocaleDateString("pt-BR", {
    day: "2-digit",
    month: "long",
    year: "numeric",
    timeZone: "America/Sao_Paulo",
  });
}

async function gerarAnalise(noticias: { titulo: string; fonte: string }[]): Promise<string> {
  const lista = noticias
    .map((n, i) => `${i + 1}. ${n.titulo} — ${n.fonte}`)
    .join("\n");

  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "analise-semanal-vip",
    max_tokens: 400,
    messages: [{
      role: "user",
      content: `Você é o Capitão Braga, ex-militar evangélico, direto e patriótico.
Com base nas principais notícias políticas desta semana, escreva a "Semana em Perspectiva" para seus membros VIP.
200-250 palavras. Tom indignado mas articulado. Conecte os eventos à defesa da família, fé e soberania.
Termine com: "Deus, Pátria e Família — sempre."

NOTÍCIAS DA SEMANA:
${lista}

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

  try {
    if (!ehSegundaFeiraBRT()) {
      return NextResponse.json({ ok: true, motivo: "só roda às segundas-feiras" });
    }

    const jaEnviou = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'analise-semanal-vip'
        AND created_at >= NOW() - INTERVAL '6 days'
      LIMIT 1
    `;
    if (jaEnviou.length > 0) {
      return NextResponse.json({ ok: true, motivo: "já enviado esta semana" });
    }

    const noticias = await sql`
      SELECT titulo, fonte
      FROM noticias
      WHERE postada_vip = true
        AND resumo_braga IS NOT NULL
        AND created_at > NOW() - INTERVAL '7 days'
      ORDER BY urgente DESC, created_at DESC
      LIMIT 5
    `;

    if (!noticias.length) {
      await alertarTelegram("🟡", "Análise Semanal VIP", "Sem notícias VIP dos últimos 7 dias — análise cancelada.");
      return NextResponse.json({ ok: false, motivo: "sem notícias VIP esta semana" });
    }

    const analise = await gerarAnalise(noticias as { titulo: string; fonte: string }[]);
    if (!analise) {
      await alertarTelegram("🔴", "Análise Semanal VIP", "Claude não gerou o texto — verifique a API.");
      return NextResponse.json({ ok: false, motivo: "falha na geração do texto" });
    }

    const data = dataSemanaBRT();
    const mensagem =
      `🗓️ *SEMANA EM PERSPECTIVA — VIP PREMIUM*\n` +
      `_${data} — Capitão Roberto Braga_\n\n` +
      `${analise}\n\n` +
      `*Deus, Pátria e Família — sempre.*\n` +
      `*— Capitão Roberto Braga*`;

    const enviado = await enviarMensagemGrupo("vip", mensagem);
    if (!enviado) {
      await alertarTelegram("🔴", "Análise Semanal VIP", "Evolution API recusou o envio para o grupo VIP.");
      return NextResponse.json({ ok: false, motivo: "falha no envio WhatsApp" });
    }

    const duracao = Date.now() - inicio;
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'analise-semanal-vip',
        'enviar_analise',
        'sucesso',
        ${JSON.stringify({ data, totalNoticias: noticias.length })},
        ${duracao}
      )
    `;

    await alertarTelegram("🟢", "Análise Semanal VIP", `"Semana em Perspectiva" enviada para o grupo VIP.\n${noticias.length} notícias analisadas · ${duracao}ms`);

    return NextResponse.json({ ok: true, data, totalNoticias: noticias.length, duracao_ms: duracao });
  } catch (err) {
    const msg = String(err);
    await alertarTelegram("🚨", "Análise Semanal VIP — ERRO CRÍTICO", msg.substring(0, 300));
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
