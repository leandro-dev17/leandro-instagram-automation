/**
 * AGENTE SEMANA EM REVISTA — Todo sábado
 * Posta no Facebook um resumo semanal público com as 3 maiores notícias.
 * Conteúdo gratuito de aquisição — maximiza alcance orgânico.
 * GET /api/cron/semana-em-revista
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { publicarPostFacebook } from "@/lib/facebook";
import { gerarTexto } from "@/lib/ai";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Só roda aos sábados
    if (new Date().getDay() !== 6) return NextResponse.json({ ok: true, motivo: "só roda aos sábados" });

    const jaPostou = await sql`
      SELECT id FROM agentes_log WHERE agente = 'semana-em-revista'
      AND created_at >= NOW() - INTERVAL '6 days' LIMIT 1
    `;
    if (jaPostou.length > 0) return NextResponse.json({ ok: true, motivo: "já postou esta semana" });

    // Busca top 3 notícias da semana
    const noticias = await sql`
      SELECT titulo, resumo_braga FROM noticias
      WHERE resumo_braga IS NOT NULL AND (global IS NULL OR global = false)
      AND created_at >= NOW() - INTERVAL '7 days'
      ORDER BY urgente DESC, created_at DESC
      LIMIT 3
    `;

    if (!noticias.length) return NextResponse.json({ ok: false, motivo: "sem notícias" });

    const lista = noticias.map((n: {titulo: string}, i: number) => `${i+1}️⃣ ${n.titulo}`).join("\n");

    const texto = await gerarTexto({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{ role: "user", content: `Você é o Capitão Braga. Crie o post "SEMANA EM REVISTA" para o Facebook.
É um post público semanal mostrando o que aconteceu de importante.
Seja apaixonado e direto. O objetivo é fazer a pessoa querer entrar no grupo.

TOP 3 DA SEMANA:
${lista}

Estrutura:
- Linha 1: abertura impactante (ex: "A semana que o Brasil precisava saber...")
- As 3 notícias resumidas em 1 linha cada
- Fechamento convidando para o grupo

Máximo 8 linhas. Termine com: "Deus, Pátria e Família — sempre. — Capitão Braga"
Responda APENAS com o texto.` }],
    });

    if (!texto) return NextResponse.json({ ok: false });

    const post = `📰 SEMANA EM REVISTA — Alerta Patriota\n\n${texto}\n\n👉 Receba análises assim todo dia no grupo:\n${APP_URL}/assinar\n\n#AlertaPatriota #SemanEmRevista #Brasil #SemFiltro`;

    const resultado = await publicarPostFacebook(post);

    if (resultado.erro) return NextResponse.json({ ok: false, erro: resultado.erro });

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('semana-em-revista', 'postar_facebook', 'sucesso',
        ${JSON.stringify({ postId: resultado.id, noticias: noticias.length })})
    `;

    return NextResponse.json({ ok: true, postId: resultado.id });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Semana em Revista", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('semana-em-revista', 'postar_facebook', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
