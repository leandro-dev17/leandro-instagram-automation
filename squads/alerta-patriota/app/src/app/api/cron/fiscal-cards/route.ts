/**
 * FISCAL FLORA FOTO — Verifica geração e envio de cards visuais
 * Detecta quando os grupos ficam sem card visual por tempo excessivo.
 * Cards são gerados via @vercel/og (Satori) em /api/cron/gerar-card, sem Puppeteer/Chromium.
 * Alerta o Telegram com contexto claro para que o próximo cron corrija.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";

const LIMITE_HORAS_SEM_CARD: Record<string, number> = {
  vip:      5,  // 6 cards/dia = a cada ~4h
  elite:    5,
};

function horaBRT(): number {
  return new Date(
    new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" })
  ).getHours();
}

function dataBRT(): string {
  return new Date().toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();
  const horaBrt = horaBRT();
  const alertas: string[] = [];
  const statusGrupos: Record<string, unknown> = {};

  try {
    // ── 1. VERIFICAR CARDS ENVIADOS HOJE (por grupo) ─────────────────────────
    // Usa agentes_log — única fonte de verdade para cards visuais
    for (const plano of ["vip", "elite"]) {
      const limite = LIMITE_HORAS_SEM_CARD[plano] || 5;

      // Último card enviado com sucesso para este grupo
      const ultimoCard = await sql`
        SELECT created_at FROM agentes_log
        WHERE agente = 'gerador-card'
          AND acao = ${"card_" + plano}
          AND status = 'sucesso'
        ORDER BY created_at DESC
        LIMIT 1
      `;

      // Qtd de cards enviados hoje (dia calendário BRT)
      const hojeCount = await sql`
        SELECT COUNT(*) as total FROM agentes_log
        WHERE agente = 'gerador-card'
          AND acao = ${"card_" + plano}
          AND status = 'sucesso'
          AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
      `;

      const totalHoje = parseInt((hojeCount[0] as { total: string }).total);
      const semCard = ultimoCard.length === 0;
      const ultimoAt = semCard ? null : new Date((ultimoCard[0] as { created_at: string }).created_at);
      const horasDesdeUltimo = ultimoAt
        ? (Date.now() - ultimoAt.getTime()) / 3600000
        : 999;

      statusGrupos[plano] = {
        cards_hoje: totalHoje,
        horas_desde_ultimo: Math.round(horasDesdeUltimo),
        ok: horasDesdeUltimo <= limite || horaBrt < 8,
      };

      // Alerta apenas se já passou de 8h BRT e o grupo está sem card por tempo excessivo
      if (horaBrt >= 8 && horasDesdeUltimo > limite) {
        const msg = `Grupo *${plano}*: ${Math.round(horasDesdeUltimo)}h sem card visual (limite: ${limite}h)`;
        alertas.push(msg);

        await sql`
          INSERT INTO alertas (tipo, severidade, mensagem)
          VALUES ('cards_sem_envio', 'alto', ${`${plano}: ${Math.round(horasDesdeUltimo)}h sem card`})
          ON CONFLICT DO NOTHING
        `.catch(() => {});
      }
    }

    // ── 2. VERIFICAR ERROS RECENTES NO GERADOR ───────────────────────────────
    const errosRecentes = await sql`
      SELECT acao, detalhes, created_at FROM agentes_log
      WHERE agente = 'gerador-card'
        AND status = 'erro'
        AND created_at > NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC
      LIMIT 5
    `;

    if (errosRecentes.length > 0) {
      const resumo = errosRecentes
        .map((e) => `• ${(e as { acao: string }).acao}`)
        .join("\n");
      alertas.push(`${errosRecentes.length} erro(s) no gerador nas últimas 2h:\n${resumo}`);
    }

    // ── 3. ALERTAR TELEGRAM (sem auto-fix com texto — cards precisam de Puppeteer) ──
    if (alertas.length > 0) {
      const corpo = alertas.join("\n\n");
      await enviarTelegram(
        `🔍 *FLORA FOTO — ALERTA DE CARDS*\n📅 ${dataBRT()} · ${horaBrt}h BRT\n\n${corpo}\n\n` +
        `ℹ️ Cards visuais são gerados via /api/cron/gerar-card (@vercel/og).\n` +
        `O próximo cron agendado irá publicar automaticamente.\n` +
        `Se o problema persistir por mais de 10h, acione o Claude.`
      );
    }

    // ── 4. LOG DA EXECUÇÃO ───────────────────────────────────────────────────
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'flora-foto',
        'verificar_cards',
        ${alertas.length === 0 ? "sucesso" : "aviso"},
        ${JSON.stringify({ alertas: alertas.length, grupos: statusGrupos })},
        ${Date.now() - inicio}
      )
    `;

    return NextResponse.json({
      ok: true,
      alertas: alertas.length,
      grupos: statusGrupos,
      duracao_ms: Date.now() - inicio,
    });
  } catch (err) {
    await alertarTelegram("🔴", "FLORA FOTO — Erro crítico", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
