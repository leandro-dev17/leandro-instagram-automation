/**
 * REVISOR DANIELA DEFESA — Revisora de Segurança
 * Usa Claude Haiku para analisar alertas de segurança do fiscal-codigo-seguranca.
 * Gera diagnóstico técnico e escala para gerente-codigo.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import Anthropic from "@anthropic-ai/sdk";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const alertas = await sql`
      SELECT id, erro, dados FROM falhas_agentes
      WHERE agente = 'fiscal-codigo-seguranca' AND resolvido = false
      ORDER BY criado_em DESC LIMIT 10
    ` as { id: number; erro: string; dados: Record<string, unknown> }[];

    if (alertas.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas de segurança pendentes" });
    }

    const descricao = alertas.map(a => `• ${a.erro}`).join("\n");

    // Análise com Claude Haiku
    const resposta = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `Você é um especialista em segurança para Next.js. Analise estes alertas do app Receitinhas da Vovó Teresinha.

ALERTAS DETECTADOS:
${descricao}

Responda em português com:
1. Nível de risco (crítico/alto/médio/baixo)
2. O que cada falha indica
3. Ação imediata recomendada (máximo 2 linhas por item)

Seja conciso e técnico.`,
      }],
    });

    const analise = resposta.content[0].type === "text" ? resposta.content[0].text : "Análise indisponível";

    // Marca como analisados
    for (const a of alertas) {
      await sql`UPDATE falhas_agentes SET resolvido = true, resolvido_em = NOW() WHERE id = ${a.id}`;
    }

    // Escala para gerente-codigo com análise
    fetch(`${APP}/api/cron/gerente-codigo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        origem: "revisor-seguranca",
        alertas: alertas.map(a => ({ tipo: "codigo_seguranca", mensagem: a.erro })),
        analise,
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    await enviarTelegram(
      `🔐 <b>Revisora Segurança — Análise Claude</b>\n\n` +
      `<b>Alertas (${alertas.length}):</b>\n${descricao}\n\n` +
      `<b>Análise:</b>\n${analise}\n\n` +
      `📊 Gerente de Código acionado.`
    );

    return NextResponse.json({ ok: true, analise, alertas_analisados: alertas.length });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
