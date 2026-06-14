/**
 * AGENTE DAVI DOSSIÊ — Elite Global
 * Todo sábado às 10h compila as 5 análises mais importantes da semana
 * e envia como mensagem formatada para o grupo Elite.
 * (PDF adicionado na Fase 6 quando houver storage configurado)
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { gerarTexto } from "@/lib/ai";

function getSemana(): number {
  return Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Só roda aos sábados
    if (new Date().getDay() !== 6) return NextResponse.json({ ok: true, motivo: "só roda aos sábados" });

    const semana = getSemana();
    const jaEnviou = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'davi-dossie' AND created_at >= NOW() - INTERVAL '6 days' LIMIT 1
    `;
    if (jaEnviou.length > 0) return NextResponse.json({ ok: true, motivo: "já enviado esta semana" });

    // Busca as análises da semana — globais e urgentes priorizadas
    const noticias = await sql`
      SELECT titulo, resumo_cavalcanti, fonte, global, urgente
      FROM noticias
      WHERE resumo_cavalcanti IS NOT NULL
      AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY urgente DESC, global DESC, created_at DESC
      LIMIT 5
    `;

    if (noticias.length === 0) return NextResponse.json({ ok: false, motivo: "sem análises esta semana" });

    // Gera síntese da semana com Claude
    const titulosParaContexto = noticias.map((n: {titulo: string}) => n.titulo).join("\n");
    const textoSintese = await gerarTexto({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: `Você é o Prof. Bernardo Cavalcanti.
Em 3-4 linhas, faça uma síntese do que foi a semana para o conservadorismo global e brasileiro.
PRINCIPAIS TEMAS DA SEMANA:\n${titulosParaContexto}\n
Tom: analítico, perspicaz, conciso.
Termine com: "O mundo muda para quem enxerga antes."
Responda APENAS com o texto.` }],
    });
    const dataHoje = new Date().toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });

    // Monta dossiê
    let dossie = `📄 *DOSSIÊ SEMANAL ELITE GLOBAL*\n🗓️ Semana de ${dataHoje}\n_Prof. Dr. Bernardo Cavalcanti_\n\n`;
    dossie += `*SÍNTESE DA SEMANA:*\n${textoSintese}\n\n`;
    dossie += `━━━━━━━━━━━━━━━━\n*TOP 5 ANÁLISES:*\n\n`;

    noticias.forEach((n: {titulo: string; resumo_cavalcanti: string; fonte: string; global: boolean; urgente: boolean}, i: number) => {
      const icone = n.urgente ? "🚨" : n.global ? "🌍" : "🇧🇷";
      dossie += `${icone} *${i + 1}. ${n.titulo.replace(/^\[(EN|ES|PT)\]\s*/i, "")}*\n`;
      dossie += `_${n.fonte}_\n`;
      // Resumo curto (primeiras 2 linhas)
      const resumoCurto = n.resumo_cavalcanti?.split("\n").slice(0, 2).join(" ").substring(0, 200) + "...";
      dossie += `${resumoCurto}\n\n`;
    });

    dossie += `━━━━━━━━━━━━━━━━\n_O mundo muda para quem enxerga antes._`;

    await enviarMensagemGrupo("elite", dossie);

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('davi-dossie', 'enviar_dossie', 'sucesso',
        ${JSON.stringify({ semana, totalNoticias: noticias.length })})
    `;

    return NextResponse.json({ ok: true, semana, totalNoticias: noticias.length });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Davi Dossiê", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('davi-dossie', 'enviar_dossie', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
