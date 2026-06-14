/**
 * AGENTE BOM DIA PATRIOTA
 * Todo dia às 7h posta um resumo matinal no VIP e Elite.
 * VIP: Capitão Braga contextualiza o dia. Elite: Prof. Cavalcanti com perspectiva global.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { gerarTexto } from "@/lib/ai";

async function gerarBomDia(noticias: string[], persona: "braga" | "cavalcanti"): Promise<string> {
  const lista = noticias.slice(0, 5).join("\n");
  const hora = new Date().toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long", timeZone: "America/Sao_Paulo" });

  if (persona === "braga") {
    const texto = await gerarTexto({
      model: "claude-haiku-4-5-20251001",
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
    const noticias = await sql`
      SELECT titulo FROM noticias
      WHERE created_at >= NOW() - INTERVAL '20 hours'
      ORDER BY urgente DESC, created_at DESC LIMIT 8
    `;
    const titulos = noticias.map((n: { titulo: string }) => n.titulo);

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
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
