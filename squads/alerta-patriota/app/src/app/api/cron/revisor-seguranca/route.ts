/**
 * REVISOR DE SEGURANÇA (Nível 3)
 * Acionado pelo fiscal-codigo-seguranca quando detecta problemas.
 * Faz análise mais profunda e escala para gerente-codigo.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import Anthropic from "@anthropic-ai/sdk";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // Busca alertas de segurança não resolvidos das últimas 2h
    const alertasSeguranca = await sql`
      SELECT id, mensagem, created_at FROM alertas
      WHERE tipo = 'codigo_seguranca' AND resolvido = false
      AND created_at >= NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC LIMIT 10
    `;

    if (alertasSeguranca.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas de segurança pendentes" });
    }

    // Usa Claude para analisar os problemas e sugerir correções
    const problemas = alertasSeguranca.map(a => a.mensagem).join("\n");
    const analise = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1000,
      messages: [{
        role: "user",
        content: `Você é um revisor de segurança de software. Analise estes problemas de segurança detectados em uma API Next.js:

${problemas}

Para cada problema:
1. Classifique a gravidade real (CRÍTICO/ALTO/MÉDIO)
2. Explique o risco em uma linha
3. Indique o arquivo e linha mais provável
4. Sugira a correção em código (máximo 3 linhas)

Responda em português, de forma concisa.`,
      }],
    });

    const analiseTexto = analise.content[0].type === "text" ? analise.content[0].text : "Sem análise";

    // Registra a análise
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('revisor-seguranca', 'analisar_problemas', 'sucesso',
        ${JSON.stringify({ alertas: alertasSeguranca.length, analise: analiseTexto.substring(0, 500) })},
        ${Date.now() - inicio})
    `;

    // Notifica com a análise
    await alertarTelegram("🔐", "REVISOR SEGURANÇA — ANÁLISE COMPLETA",
      `${alertasSeguranca.length} problema(s) analisado(s):\n\n${analiseTexto.substring(0, 600)}\n\n⚠️ Escalando para Gerente de Código...`
    );

    // Escala para gerente-codigo
    await fetch(`${APP}/api/cron/gerente-codigo`, {
      headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    return NextResponse.json({ ok: true, alertasAnalisados: alertasSeguranca.length });
  } catch (err) {
    await alertarTelegram("🚨", "REVISOR SEGURANÇA — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
