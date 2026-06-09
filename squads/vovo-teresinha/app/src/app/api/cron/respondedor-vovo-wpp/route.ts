import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE || "vovo-teresinha";

const SYSTEM_VOVO = `Você é a Vovó Teresinha, uma avó carinhosa e especialista em culinária saudável brasileira.
Responda sempre com amor, calor humano e um toque de sabedoria de vovó.
Fale sobre receitas, dicas de alimentação saudável e o app Receitinhas da Vovó Teresinha.
Se perguntarem sobre assinatura, mencione os planos: trimestral R$29,90 ou anual R$79,90.
Responda de forma curta e afetuosa, como uma mensagem de WhatsApp (máximo 3 parágrafos).`;

async function buscarMensagensNaoRespondidas(): Promise<Array<{ id: string; numero: string; mensagem: string }>> {
  if (!EVO_URL || !EVO_KEY) return [];
  try {
    const res = await fetch(`${EVO_URL}/chat/findMessages/${EVO_INSTANCE}`, {
      headers: { apikey: EVO_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    // Filtra mensagens recebidas não respondidas nas últimas 2h
    const duasHorasAtras = Date.now() - 2 * 60 * 60 * 1000;
    return (data.messages?.records || [])
      .filter((m: { key: { fromMe: boolean }; messageTimestamp: number; message?: { conversation?: string } }) =>
        !m.key.fromMe &&
        m.messageTimestamp * 1000 > duasHorasAtras &&
        m.message?.conversation
      )
      .slice(0, 5) // máximo 5 respostas por execução
      .map((m: { key: { id: string; remoteJid: string }; message: { conversation: string } }) => ({
        id: m.key.id,
        numero: m.key.remoteJid,
        mensagem: m.message.conversation,
      }));
  } catch {
    return [];
  }
}

async function enviarResposta(numero: string, texto: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY) return false;
  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({ number: numero, text: texto }),
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

async function jaRespondido(msgId: string): Promise<boolean> {
  const [r] = await sql`
    SELECT 1 FROM app_configuracoes WHERE chave = ${`wpp_respondido_${msgId}`} LIMIT 1
  `;
  return !!r;
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  if (!EVO_URL || !EVO_KEY) {
    return NextResponse.json({ ok: true, msg: "Evolution API não configurada — pulando" });
  }

  try {
    const mensagens = await buscarMensagensNaoRespondidas();
    const respondidas: string[] = [];

    for (const msg of mensagens) {
      if (await jaRespondido(msg.id)) continue;

      const response = await client.messages.create({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 400,
        system: SYSTEM_VOVO,
        messages: [{ role: "user", content: msg.mensagem }],
      });

      const resposta = response.content[0].type === "text" ? response.content[0].text : "";
      if (!resposta) continue;

      const enviado = await enviarResposta(msg.numero, resposta);
      if (enviado) {
        await sql`
          INSERT INTO app_configuracoes (chave, valor) VALUES (${`wpp_respondido_${msg.id}`}, 'true')
          ON CONFLICT (chave) DO UPDATE SET valor = 'true'
        `;
        respondidas.push(msg.numero);
      }
    }

    await resolverFalhas("respondedor-vovo-wpp");
    return NextResponse.json({ ok: true, respondidas: respondidas.length });
  } catch (err) {
    await reportarFalha("respondedor-vovo-wpp", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
