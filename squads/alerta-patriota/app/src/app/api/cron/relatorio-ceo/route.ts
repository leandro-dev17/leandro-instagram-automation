/**
 * GENERAL ALVES CEO — Relatório diário às 8h + escalonamento até Claude
 * Consolida dados de todos os agentes e envia para Leandro via Telegram.
 * Última linha de defesa: aciona Claude via BioNexus quando nada funciona.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { relatorioCEO, alertarTelegram, enviarTelegram } from "@/lib/telegram";

function emoji(n: number, max: number) {
  const pct = n / max;
  return pct > 0.7 ? "🟢" : pct > 0.3 ? "🟡" : "🔴";
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // ── COLETA DADOS ────────────────────────────────────────────────────────
    const [membros, financeiro, conteudo, alertasAbertos, errosAgentes] = await Promise.all([
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ativo')   as ativos,
          COUNT(*) FILTER (WHERE status = 'trial')   as trial,
          COUNT(*) FILTER (WHERE status = 'cancelado' AND updated_at >= NOW() - INTERVAL '24 hours') as cancelados_24h,
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as novos_24h,
          COUNT(*) FILTER (WHERE plano = 'vip'      AND status = 'ativo') as vip,
          COUNT(*) FILTER (WHERE plano = 'elite'    AND status = 'ativo') as elite
        FROM usuarios
      `,
      sql`
        SELECT
          COALESCE(SUM(CASE WHEN plano='vip'      AND ciclo='mensal'  THEN 9.90
                            WHEN plano='elite'    AND ciclo='mensal'  THEN 19.90
                            ELSE 0 END), 0) as mrr_estimado
        FROM assinaturas WHERE status = 'ativa'
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as coletadas_24h,
          COUNT(*) FILTER (WHERE postada_vip = false AND resumo_braga IS NOT NULL) as aguardando_publicacao
        FROM noticias
      `,
      sql`SELECT COUNT(*) as total FROM alertas WHERE resolvido = false`,
      sql`
        SELECT COUNT(*) as total FROM agentes_log
        WHERE status = 'erro' AND created_at >= NOW() - INTERVAL '24 hours'
      `,
    ]);

    const m = membros[0];
    const mrr = Number(financeiro[0].mrr_estimado).toFixed(2).replace(".", ",");
    const alertasAbertosN = Number(alertasAbertos[0].total);
    const erros24h = Number(errosAgentes[0].total);

    // ── SAÚDE GERAL ──────────────────────────────────────────────────────────
    const saudeTecnica = alertasAbertosN === 0 && erros24h < 5;
    const saudeFinanceira = Number(m.cancelados_24h) <= 2;
    const saudeGeral = saudeTecnica && saudeFinanceira ? "🟢 VERDE" : !saudeTecnica ? "🔴 VERMELHO" : "🟡 AMARELO";

    // ── MONTA RELATÓRIO ──────────────────────────────────────────────────────
    const relatorio = `
👑 <b>GENERAL ALVES — RELATÓRIO DIÁRIO</b>
📅 ${new Date().toLocaleDateString("pt-BR")} — 08:00

<b>MEMBROS</b>
${emoji(Number(m.ativos), 100)} Ativos: ${m.ativos} | Trial: ${m.trial}
📈 Novos (24h): +${m.novos_24h} | Cancelamentos (24h): -${m.cancelados_24h}
🔥 VIP: ${m.vip} | 🎖️ Elite: ${m.elite}

<b>FINANCEIRO</b>
💰 MRR estimado: R$ ${mrr}

<b>CONTEÚDO (24h)</b>
📰 Notícias coletadas: ${conteudo[0].coletadas_24h}
⏳ Aguardando publicação: ${conteudo[0].aguardando_publicacao}

<b>SISTEMA</b>
🚨 Alertas abertos: ${alertasAbertosN}
❌ Erros de agentes (24h): ${erros24h}

<b>SAÚDE GERAL: ${saudeGeral}</b>
${alertasAbertosN > 0 ? "\n⚠️ Há alertas não resolvidos — verificar painel admin." : "✅ Nenhuma ação necessária hoje."}
    `.trim();

    await enviarTelegram(relatorio);

    // ── ESCALONAMENTO: CEO → CLAUDE RESOLVER (antes de incomodar Leandro) ──────
    // Hierarquia: Fiscal → Gerente → CEO → Claude Resolver → Leandro (último recurso)
    const criticos = await sql`
      SELECT id, tipo, severidade, mensagem FROM alertas
      WHERE severidade = 'critico' AND resolvido = false
      AND created_at <= NOW() - INTERVAL '2 hours'
      LIMIT 5
    `;

    if (criticos.length > 0) {
      const origemParam = req.nextUrl.searchParams.get("origem") ?? "relatorio-ceo";
      const scoreParam  = req.nextUrl.searchParams.get("score")  ?? "baixo";

      // Chama Claude Resolver — ele tenta auto-fix e SÓ alerta Leandro se não conseguir
      await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/webhooks/claude-resolver`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.CLAUDE_AUTOFIX_SECRET || process.env.CRON_SECRET}`,
        },
        body: JSON.stringify({
          agente:     origemParam,
          tipo:       (criticos[0] as { tipo: string }).tipo,
          erro:       (criticos[0] as { mensagem: string }).mensagem,
          tentativas: 1,
          dados:      { score: scoreParam, totalCriticos: criticos.length },
        }),
        signal: AbortSignal.timeout(30000),
      }).catch(() => {});
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('general-alves-ceo', 'relatorio_diario', 'sucesso', ${JSON.stringify({ mrr, ativos: m.ativos, alertasAbertos: alertasAbertosN, saudeGeral })})`;

    return NextResponse.json({ ok: true, saudeGeral, mrr, ativos: m.ativos });
  } catch (err) {
    await alertarTelegram("🚨", "GENERAL ALVES CEO — FALHA CRÍTICA", `O relatório diário não foi gerado.\n\n${String(err)}`);
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
