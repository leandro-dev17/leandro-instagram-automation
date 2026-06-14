/**
 * AGENTE RESUMO DA NOITE
 * Todo dia às 21h posta o veredicto do dia no VIP e Elite.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { gerarTexto } from "@/lib/ai";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const noticias = await sql`
      SELECT titulo FROM noticias
      WHERE created_at >= NOW() - INTERVAL '16 hours'
      ORDER BY urgente DESC, created_at DESC LIMIT 10
    `;
    const titulos = noticias.map((n: { titulo: string }) => n.titulo).join("\n");

    if (!titulos) return NextResponse.json({ ok: true, motivo: "sem notícias" });

    const [textoBraga, textoCavalcanti] = await Promise.all([
      gerarTexto({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 350,
        messages: [{ role: "user", content: `Você é o Capitão Braga. Fim de dia.
Com base nas notícias de hoje, escreva o "Resumo da Noite" em 4-5 linhas:
- Dê o veredicto do Capitão sobre o dia
- O que foi vitória para o Brasil? O que foi derrota?
- Tom direto e sincero
Termine com: "Deus, Pátria e Família — sempre."

NOTÍCIAS DO DIA:\n${titulos}\n\nResponda APENAS com o texto.` }],
      }),
      gerarTexto({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        messages: [{ role: "user", content: `Você é o Prof. Bernardo Cavalcanti. Fim de dia.
Escreva a "Análise do Fim do Dia" em 5-6 linhas:
- O que foi mais significativo hoje no Brasil e no mundo?
- Quais tendências se confirmaram?
- Tom analítico e perspicaz
Termine com: "O mundo muda para quem enxerga antes."

NOTÍCIAS DO DIA:\n${titulos}\n\nResponda APENAS com o texto.` }],
      }),
    ]);

    await Promise.all([
      enviarMensagemGrupo("vip", `🌙 *RESUMO DA NOITE*\n\n${textoBraga}`),
      enviarMensagemGrupo("elite", `🌙 *ANÁLISE DO FIM DO DIA — PROF. CAVALCANTI*\n\n${textoCavalcanti}`),
    ]);

    await sql`INSERT INTO agentes_log (agente, acao, status) VALUES ('resumo-noite', 'enviar_vip_elite', 'sucesso')`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Resumo da Noite", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('resumo-noite', 'enviar_vip_elite', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
