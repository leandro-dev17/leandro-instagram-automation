/**
 * TEREZA TRIAL — Monitora trials expirando sem converter
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const CRON_SECRET = process.env.CRON_SECRET!;

function formatarHora(isoString: string): string {
  return new Date(isoString).toLocaleTimeString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // 1. Trials expirando nas próximas 24h
    const expirando = await sql`
      SELECT u.id, u.nome, u.email, u.plano, u.trial_fim
      FROM usuarios u
      WHERE u.status = 'trial'
        AND u.trial_fim BETWEEN NOW() AND NOW() + INTERVAL '24 hours'
      ORDER BY u.trial_fim ASC
    `;

    // 2. Para cada trial expirando, verifica se já houve pagamento aprovado
    const emRisco: Array<{ id: unknown; nome: unknown; plano: unknown; trial_fim: string }> = [];

    for (const u of expirando) {
      const pagamentos = await sql`
        SELECT id FROM pagamentos
        WHERE usuario_id = ${u.id}
          AND status = 'aprovado'
          AND created_at >= NOW() - INTERVAL '48 hours'
        LIMIT 1
      `;
      if (pagamentos.length === 0) {
        emRisco.push({
          id: u.id,
          nome: u.nome,
          plano: u.plano,
          trial_fim: String(u.trial_fim),
        });
      }
    }

    // 3. Trials já expirados com status ainda 'trial' (churn confirmado)
    const churnConfirmado = await sql`
      SELECT u.id, u.nome, u.email, u.plano, u.trial_fim
      FROM usuarios u
      WHERE u.status = 'trial'
        AND u.trial_fim < NOW()
      ORDER BY u.trial_fim DESC
    `;

    const qtdChurn = churnConfirmado.length;

    // 4. Alerta Telegram se há risco ou churn
    if (emRisco.length > 0 || qtdChurn > 0) {
      const linhasRisco = emRisco
        .map((u) => `• ${u.nome} (${u.plano}) — expira ${formatarHora(u.trial_fim)}`)
        .join("\n");

      const autoFixMsg = qtdChurn > 0 ? `\nChurn confirmado hoje: ${qtdChurn} usuário(s)\nAuto-fix: Enzo Engajamento acionado.` : "";

      // Janela curta (2h, menor que o padrão de 6h) porque a lista de usuários em risco
      // muda ao longo do dia — dedup evita reenviar a mesma lista sem mudança, sem
      // esconder churn novo por tempo demais.
      const { criado } = await criarAlertaDedup("fiscal_trials_em_risco", emRisco.length > 0 ? "alto" : "medio", `${emRisco.length} em risco, ${qtdChurn} churn confirmado`, 2);
      if (criado) {
        await alertarTelegram(
          emRisco.length > 0 ? "🔴" : "🟡",
          "TEREZA TRIAL — Trials em Risco",
          `⚡ Expirando em 24h (não converteram):\n${linhasRisco || "(nenhum)"}\n${autoFixMsg}`
        );
      }

      if (qtdChurn > 0) {
        try {
          await fetch(`${APP_URL}/api/cron/engajamento`, {
            method: "GET",
            headers: { Authorization: `Bearer ${CRON_SECRET}` },
          });
        } catch {
          // engajamento pode estar indisponível, seguimos
        }
      }
    }

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'tereza-trial',
        'verificar_trials',
        ${emRisco.length > 0 || qtdChurn > 0 ? "aviso" : "sucesso"},
        ${JSON.stringify({
          trials_expirando_24h: expirando.length,
          em_risco: emRisco.length,
          churn_confirmado: qtdChurn,
          lista_risco: emRisco.map((u) => ({ id: u.id, nome: u.nome, plano: u.plano })),
        })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: true,
      trials_expirando_24h: expirando.length,
      em_risco: emRisco.length,
      churn_confirmado: qtdChurn,
      lista_risco: emRisco,
      duracao_ms: duracao,
    });
  } catch (err) {
    const { criado } = await criarAlertaDedup("fiscal_trials_erro", "alto", String(err)).catch(() => ({ criado: false }));
    if (criado) {
      await alertarTelegram("🚨", "TEREZA TRIAL — ERRO INTERNO", String(err));
    }
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
