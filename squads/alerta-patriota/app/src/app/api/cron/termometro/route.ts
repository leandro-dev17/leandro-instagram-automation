/**
 * AGENTE TEREZA TERMÔMETRO
 * Toda domingo às 20h gera o Termômetro da Liberdade e posta em todos os grupos.
 * GET /api/cron/termometro
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { gerarTexto } from "@/lib/ai";

function getSemanaAno(): { semana: number; ano: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  const semana = Math.ceil(((now.getTime() - start.getTime()) / 86400000 + start.getDay() + 1) / 7);
  return { semana, ano: now.getFullYear() };
}

async function gerarTermometro(noticias: string[]): Promise<{
  democracia: number; economia: number; seguranca: number; soberania: number; analise: string;
}> {
  const lista = noticias.slice(0, 10).join("\n");

  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    agente: "tereza-termometro",
    max_tokens: 500,
    messages: [{
      role: "user",
      content: `Você é o Capitão Braga. Com base nas notícias desta semana, avalie de 1 a 10 (1=péssimo, 10=ótimo) do ponto de vista conservador patriótico:

NOTÍCIAS DA SEMANA:
${lista}

Responda EXATAMENTE neste formato JSON:
{"democracia":X,"economia":X,"seguranca":X,"soberania":X,"analise":"Uma frase direta e impactante sobre a semana em geral."}`,
    }],
  });

  const text = texto || "{}";
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return { democracia: 4, economia: 4, seguranca: 3, soberania: 5, analise: "Semana difícil para o Brasil patriótico." };

  try {
    return JSON.parse(match[0]);
  } catch {
    return { democracia: 4, economia: 4, seguranca: 3, soberania: 5, analise: "Semana difícil para o Brasil patriótico." };
  }
}

function buildTermometroVIP(t: { democracia: number; economia: number; seguranca: number; soberania: number; analise: string }, semana: number): string {
  const emoji = (n: number) => n >= 7 ? "🟢" : n >= 5 ? "🟡" : "🔴";
  return (
    `🌡️ *TERMÔMETRO DA LIBERDADE — Semana ${semana}*\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `${emoji(t.democracia)} Democracia: ${t.democracia}/10\n` +
    `${emoji(t.economia)} Economia: ${t.economia}/10\n` +
    `${emoji(t.seguranca)} Segurança: ${t.seguranca}/10\n` +
    `${emoji(t.soberania)} Soberania: ${t.soberania}/10\n` +
    `━━━━━━━━━━━━━━━━\n` +
    `📊 ${t.analise}\n\n` +
    `_Capitão Braga — Alerta Patriota_\n` +
    `_Deus, Pátria e Família — sempre._`
  );
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const { semana, ano } = getSemanaAno();

  try {
    // Verifica se já gerou esta semana
    const jaGerou = await sql`SELECT id FROM termometro WHERE semana = ${semana} AND ano = ${ano} LIMIT 1`;
    if (jaGerou.length > 0) {
      return NextResponse.json({ ok: true, motivo: "já gerado esta semana" });
    }

    // Busca títulos da semana para contexto
    const noticias = (await sql`
      SELECT titulo FROM noticias
      WHERE created_at >= NOW() - INTERVAL '7 days'
      ORDER BY urgente DESC, created_at DESC
      LIMIT 15
    `) as unknown as { titulo: string }[];
    const titulos = noticias.map((n) => n.titulo);

    // Gera termômetro com Claude
    const t = await gerarTermometro(titulos);

    // Salva no banco
    await sql`
      INSERT INTO termometro (semana, ano, democracia, economia, seguranca, soberania, analise)
      VALUES (${semana}, ${ano}, ${t.democracia}, ${t.economia}, ${t.seguranca}, ${t.soberania}, ${t.analise})
      ON CONFLICT (semana, ano) DO NOTHING
    `;

    // Posta versão completa no VIP e Elite
    const msgVIP = buildTermometroVIP(t, semana);
    await Promise.all([
      enviarMensagemGrupo("vip", msgVIP),
      enviarMensagemGrupo("elite", msgVIP),
    ]);

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('tereza-termometro', 'gerar_termometro', 'sucesso',
        ${JSON.stringify({ semana, ano, scores: t })}, 0)
    `;

    return NextResponse.json({ ok: true, semana, scores: t });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Tereza Termômetro", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('tereza-termometro', 'gerar_termometro', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
