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

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const noticias = (await sql`
      SELECT titulo FROM noticias
      WHERE created_at >= NOW() - INTERVAL '16 hours'
      ORDER BY urgente DESC, created_at DESC LIMIT 10
    `) as unknown as { titulo: string }[];
    const titulos = noticias.map((n) => n.titulo).join("\n");

    if (!titulos) return NextResponse.json({ ok: true, motivo: "sem notícias" });

    const [textoBraga, textoCavalcanti] = await Promise.all([
      gerarTexto({
        model: "claude-haiku-4-5-20251001",
        agente: "resumo-noite",
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
        agente: "resumo-noite",
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

    // FASE 17: antes enviava direto, mesmo se a IA tivesse retornado texto
    // vazio (mensagem chegava ao grupo só com o cabeçalho, e ainda era
    // registrada como 'sucesso'). Agora só envia o que de fato foi gerado, e
    // o retorno do envio também é checado antes de logar sucesso.
    const enviosVip = textoBraga
      ? await enviarMensagemGrupo("vip", `🌙 *RESUMO DA NOITE*\n\n${textoBraga}`)
      : false;
    const enviosElite = textoCavalcanti
      ? await enviarMensagemGrupo("elite", `🌙 *ANÁLISE DO FIM DO DIA — PROF. CAVALCANTI*\n\n${textoCavalcanti}`)
      : false;

    if (!textoBraga || !textoCavalcanti) {
      await alertarTelegram("🟡", "Resumo da Noite — texto vazio da IA",
        `VIP: ${textoBraga ? "ok" : "texto vazio, não enviado"}\nElite: ${textoCavalcanti ? "ok" : "texto vazio, não enviado"}`);
    }
    if ((textoBraga && !enviosVip) || (textoCavalcanti && !enviosElite)) {
      await alertarTelegram("🔴", "Resumo da Noite — falha no envio WhatsApp",
        `VIP enviado: ${enviosVip}\nElite enviado: ${enviosElite}`);
    }

    const status = enviosVip && enviosElite ? "sucesso" : (enviosVip || enviosElite) ? "aviso" : "erro";
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('resumo-noite', 'enviar_vip_elite', ${status},
        ${JSON.stringify({ vipEnviado: enviosVip, eliteEnviado: enviosElite, textoVipVazio: !textoBraga, textoEliteVazio: !textoCavalcanti })})
    `;
    return NextResponse.json({ ok: !!(enviosVip || enviosElite), vipEnviado: enviosVip, eliteEnviado: enviosElite });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Resumo da Noite", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('resumo-noite', 'enviar_vip_elite', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
