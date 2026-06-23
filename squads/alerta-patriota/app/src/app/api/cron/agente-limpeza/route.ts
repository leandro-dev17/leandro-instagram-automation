/**
 * MAX MEMÓRIA — Limpeza mensal do banco de dados
 * Executa no dia 1 de cada mês para manter performance.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const agora = new Date();
  const forcar = new URL(req.url).searchParams.get("forcar") === "true";

  if (agora.getDate() !== 1 && !forcar) {
    return NextResponse.json({ ok: true, mensagem: "Limpeza só executa no dia 1 do mês.", dia: agora.getDate() });
  }

  const inicioMes = new Date(agora.getFullYear(), agora.getMonth(), 1);

  try {
    const jaRodou = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'max-memoria'
        AND status = 'sucesso'
        AND created_at >= ${inicioMes.toISOString()}
      LIMIT 1
    `;

    if (jaRodou.length > 0 && !forcar) {
      return NextResponse.json({ ok: true, mensagem: "Limpeza já executada neste mês.", deduplicado: true });
    }

    const [logRes, noticiasRes, alertasRes, postsRes, leadsRes] = await Promise.all([
      sql`DELETE FROM agentes_log WHERE created_at < NOW() - INTERVAL '90 days' RETURNING id`,
      sql`
        DELETE FROM noticias
        WHERE postada_vip = true
          AND postada_elite = true
          AND created_at < NOW() - INTERVAL '60 days'
        RETURNING id
      `,
      sql`DELETE FROM alertas WHERE resolvido = true AND created_at < NOW() - INTERVAL '30 days' RETURNING id`,
      sql`DELETE FROM posts_whatsapp WHERE enviado_at < NOW() - INTERVAL '90 days' RETURNING id`,
      // FASE 22 (LGPD): leads que nunca converteram ficavam retidos para sempre —
      // sem prazo de retenção definido, é dado pessoal (nome/e-mail/telefone) acumulando
      // indefinidamente. 180 dias é tempo suficiente para qualquer sequência de
      // recuperação/e-mail/whatsapp já ter rodado e esgotado.
      sql`DELETE FROM leads WHERE convertido = false AND created_at < NOW() - INTERVAL '180 days' RETURNING id`,
    ]);

    const contagens = {
      agentes_log: logRes.length,
      noticias: noticiasRes.length,
      alertas: alertasRes.length,
      posts_whatsapp: postsRes.length,
      leads: leadsRes.length,
    };

    const totalRows = contagens.agentes_log + contagens.noticias + contagens.alertas + contagens.posts_whatsapp + contagens.leads;
    const bytesLiberados = totalRows * 500;
    const mbLiberados = (bytesLiberados / 1_048_576).toFixed(0);

    const mesNome = agora.toLocaleString("pt-BR", { month: "long", timeZone: "America/Sao_Paulo" });
    const anoAtual = agora.getFullYear();
    const mesCapitalizado = mesNome.charAt(0).toUpperCase() + mesNome.slice(1);

    const relatorio =
      `🧹 <b>MAX MEMÓRIA — Limpeza Mensal Concluída</b>\n` +
      `📅 ${mesCapitalizado} ${anoAtual}\n\n` +
      `Registros removidos:\n` +
      `• agentes_log: ${contagens.agentes_log.toLocaleString("pt-BR")} entradas (&gt; 90 dias)\n` +
      `• noticias: ${contagens.noticias.toLocaleString("pt-BR")} notícias publicadas (&gt; 60 dias)\n` +
      `• alertas: ${contagens.alertas.toLocaleString("pt-BR")} alertas resolvidos (&gt; 30 dias)\n` +
      `• posts_whatsapp: ${contagens.posts_whatsapp.toLocaleString("pt-BR")} posts (&gt; 90 dias)\n` +
      `• leads: ${contagens.leads.toLocaleString("pt-BR")} leads não convertidos (&gt; 180 dias)\n\n` +
      `Estimativa liberada: ~${mbLiberados} MB\n` +
      `Banco mantido enxuto para melhor performance. ✅`;

    await enviarTelegram(relatorio);

    const duracao_ms = Date.now() - inicio;
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'max-memoria',
        'limpeza_mensal',
        'sucesso',
        ${JSON.stringify({ ...contagens, total_rows: totalRows, mb_liberados: mbLiberados })},
        ${duracao_ms}
      )
    `;

    return NextResponse.json({ ok: true, contagens, mb_liberados: mbLiberados, duracao_ms });
  } catch (err) {
    const duracao_ms = Date.now() - inicio;
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('max-memoria', 'limpeza_mensal', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao_ms})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
