/**
 * AGENTE BOM DIA PATRIOTA
 * Todo dia às 7h posta um resumo matinal no VIP e Elite.
 * VIP: Capitão Braga contextualiza o dia. Elite: Prof. Cavalcanti com perspectiva global.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { gerarTexto } from "@/lib/ai";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

async function gerarBomDia(noticias: string[], persona: "braga" | "cavalcanti"): Promise<string> {
  const lista = noticias.slice(0, 5).join("\n");
  const hora = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });

  if (persona === "braga") {
    const texto = await gerarTexto({
      model: "claude-haiku-4-5-20251001",
      agente: "bom-dia",
      max_tokens: 350,
      messages: [{ role: "user", content: `Você é o Capitão Braga. É ${hora}.
Com base nestas manchetes de hoje, escreva um "Bom Dia Patriota" em 4-5 linhas:
- Cumprimente os patriotas
- Indique o que está mais quente hoje
- O tom é motivador e indignado
Termine com: "Deus, Pátria e Família — sempre."

MANCHETES: ${lista}

Responda APENAS com o texto.` }],
    });
    return texto;
  }

  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "bom-dia",
    max_tokens: 400,
    messages: [{ role: "user", content: `Você é o Prof. Bernardo Cavalcanti. É ${hora}.
Com base nestas manchetes, escreva um "Briefing Matinal Elite" em 5-6 linhas:
- Tom analítico e sofisticado
- Destaque o que é mais relevante geopoliticamente
- Conecte ao cenário global quando possível
Termine com: "O mundo muda para quem enxerga antes."

MANCHETES: ${lista}

Responda APENAS com o texto.` }],
  });
  return texto;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const noticias = (await sql`
      SELECT titulo FROM noticias
      WHERE created_at >= NOW() - INTERVAL '20 hours'
      ORDER BY urgente DESC, created_at DESC LIMIT 8
    `) as unknown as { titulo: string }[];
    const titulos = noticias.map((n) => n.titulo);

    if (titulos.length === 0) return NextResponse.json({ ok: true, motivo: "sem notícias" });

    const [msgBraga, msgCavalcanti] = await Promise.all([
      gerarBomDia(titulos, "braga"),
      gerarBomDia(titulos, "cavalcanti"),
    ]);

    const bomDiaVIP = `🌅 *BOM DIA, PATRIOTA!*\n\n${msgBraga}`;
    const bomDiaElite = `🌅 *BRIEFING MATINAL — ELITE GLOBAL*\n\n${msgCavalcanti}`;

    await Promise.all([
      enviarMensagemGrupo("vip", bomDiaVIP),
      enviarMensagemGrupo("elite", bomDiaElite),
    ]);

    await sql`INSERT INTO agentes_log (agente, acao, status) VALUES ('bom-dia', 'enviar_vip_elite', 'sucesso')`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Bom Dia Patriota", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('bom-dia', 'enviar_vip_elite', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
