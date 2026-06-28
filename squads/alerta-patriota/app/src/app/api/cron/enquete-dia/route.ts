/**
 * AGENTE ENQUETE DO DIA
 * Toda tarde às 15h cria uma enquete no grupo VIP sobre o tema mais quente.
 * Usa a API de enquete da Evolution API.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { gerarTexto } from "@/lib/ai";
import { enviarMensagemGrupo, enviarEnqueteGrupo } from "@/lib/whatsapp";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;

async function gerarEnquete(noticia: string): Promise<{ pergunta: string; opcoes: string[] } | null> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "enquete-dia",
    max_tokens: 200,
    messages: [{ role: "user", content: `Com base nesta notícia, crie uma enquete rápida e provocadora para patriotas brasileiros.
NOTÍCIA: "${noticia}"

Responda EXATAMENTE neste formato JSON:
{"pergunta":"A pergunta direta e impactante?","opcoes":["Opção A","Opção B","Opção C"]}

Regras: máximo 3 opções, linguagem simples, tema político/conservador.` }],
  });

  const text = texto || "";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try { return JSON.parse(match[0]); } catch { return null; }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Verifica se já enviou enquete hoje
    const jaEnviou = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'enquete-dia' AND status = 'sucesso'
      AND created_at >= NOW() - INTERVAL '24 hours'
      LIMIT 1
    `;
    if (jaEnviou.length > 0) return NextResponse.json({ ok: true, motivo: "já enviado hoje" });

    const noticias = await sql`
      SELECT titulo FROM noticias
      WHERE urgente = true OR categoria = 'curada'
      ORDER BY created_at DESC LIMIT 3
    `;

    if (noticias.length === 0) return NextResponse.json({ ok: true, motivo: "sem notícias" });

    const enquete = await gerarEnquete(noticias[0].titulo);
    if (!enquete) return NextResponse.json({ ok: false });

    // Mensagem contextualizando antes da enquete — se falhar, segue mesmo assim
    // (a enquete sozinha ainda é útil), mas agora com retry + alerta via lib/whatsapp.ts
    await enviarMensagemGrupo("vip", `🗳️ *ENQUETE DO DIA — Capitão Braga quer saber sua opinião, patriota!*`);

    await new Promise(r => setTimeout(r, 1000));
    const ok = await enviarEnqueteGrupo("vip", enquete.pergunta, enquete.opcoes);

    // Item 15 (Fase 30): só gravava log no sucesso — uma falha de envio (ex.: env var ausente,
    // groupId não configurado) ficava sem nenhum rastro em agentes_log e sem alerta explícito
    // (chamarEvolution só alerta no Telegram se chegou a tentar o fetch, o que não acontece nos
    // early-returns de enviarEnqueteGrupo). Mesmo padrão de "sucesso ou erro, nunca silêncio" já
    // usado em enzo-engajamento/route.ts.
    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('enquete-dia', 'enviar_enquete', ${ok ? "sucesso" : "erro"}, ${JSON.stringify({ pergunta: enquete.pergunta })})`;
    if (!ok) {
      await alertarTelegram("🔴", "Falha Agente Enquete do Dia", "enviarEnqueteGrupo retornou false — ver lib/whatsapp.ts para causa (env var ausente, groupId não configurado, ou falha do Evolution API após retries).");
    }

    return NextResponse.json({ ok, enquete });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Enquete do Dia", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('enquete-dia', 'enviar_enquete', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
