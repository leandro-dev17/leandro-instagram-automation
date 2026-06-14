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
const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA;
const GROUP_VIP = process.env.WPP_GROUP_VIP;

async function gerarEnquete(noticia: string): Promise<{ pergunta: string; opcoes: string[] } | null> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
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

async function enviarEnqueteWPP(groupJid: string, pergunta: string, opcoes: string[]): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY || !EVO_INST) return false;
  try {
    const res = await fetch(`${EVO_URL}/message/sendPoll/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        number: groupJid,
        name: pergunta,
        selectableCount: 1,
        values: opcoes,
      }),
    });
    return res.ok;
  } catch { return false; }
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
    if (!enquete || !GROUP_VIP) return NextResponse.json({ ok: false });

    // Mensagem contextualizando antes da enquete
    await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY! },
      body: JSON.stringify({
        number: GROUP_VIP,
        textMessage: { text: `🗳️ *ENQUETE DO DIA — Capitão Braga quer saber sua opinião, patriota!*` },
      }),
    });

    await new Promise(r => setTimeout(r, 1000));
    const ok = await enviarEnqueteWPP(GROUP_VIP, enquete.pergunta, enquete.opcoes);

    if (ok) {
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('enquete-dia', 'enviar_enquete', 'sucesso', ${JSON.stringify({ pergunta: enquete.pergunta })})`;
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
