/**
 * AGENTE RADAR ECONÔMICO ELITE
 * Todo dia às 10h posta análise econômica no Elite com foco conservador.
 * Monitora dólar, juros, Ibovespa e conecta ao impacto das políticas.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { gerarTexto } from "@/lib/ai";

const FONTES_ECONOMICAS = [
  "https://agencia.bcb.gov.br/rss/notas",
  "https://www.infomoney.com.br/feed/",
  "https://www.moneytimes.com.br/feed/",
  "https://braziljournal.com/feed/",
];

async function coletarDadosEconomicos(): Promise<string[]> {
  const dados: string[] = [];

  for (const url of FONTES_ECONOMICAS) {
    try {
      const res = await fetch(url, {
        headers: { "User-Agent": "AlertaPatriota/1.0" },
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;

      const xml = await res.text();
      const regex = /<(?:item|entry)[^>]*>([\s\S]*?)<\/(?:item|entry)>/g;
      let match;
      let count = 0;

      while ((match = regex.exec(xml)) !== null && count < 4) {
        const titulo = match[1].match(/<title[^>]*>(?:<!\[CDATA\[)?(.*?)(?:\]\]>)?<\/title>/s)?.[1]?.trim() || "";
        if (titulo && titulo.length > 10) { dados.push(titulo); count++; }
      }
    } catch { continue; }
  }

  return dados;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Verifica se já rodou hoje
    const jaRodou = await sql`
      SELECT id FROM agentes_log WHERE agente = 'radar-economico'
      AND created_at >= NOW() - INTERVAL '20 hours' LIMIT 1
    `;
    if (jaRodou.length > 0) return NextResponse.json({ ok: true, motivo: "já executado hoje" });

    const dadosEcon = await coletarDadosEconomicos();
    const contexto = dadosEcon.length > 0
      ? dadosEcon.join("\n")
      : "Mercado em dia de ajustes. Dólar e juros sob pressão fiscal.";

    const texto = await gerarTexto({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: `Você é o Prof. Bernardo Cavalcanti, analista econômico e político.
Com base nestes dados econômicos, escreva o "Radar Econômico" em 5-6 linhas:
- Como as políticas do governo atual estão impactando a economia?
- O que os dados indicam para os próximos meses?
- Compare com países com governos conservadores (Argentina de Milei, etc.)
- Tom: analítico, perspicaz, sem alarmismo desnecessário

DADOS:\n${contexto}\n\nTermine com: "O mundo muda para quem enxerga antes."
Responda APENAS com o texto.` }],
    });

    if (!texto) return NextResponse.json({ ok: false });

    const mensagem = `💹 *RADAR ECONÔMICO — Prof. Bernardo Cavalcanti*\n\n${texto}`;
    await enviarMensagemGrupo("elite", mensagem);

    await sql`INSERT INTO agentes_log (agente, acao, status) VALUES ('radar-economico', 'enviar_elite', 'sucesso')`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
