/**
 * AGENTE MÁRCIO CRISE
 * Ativa/desativa modo de crise. Em modo crise, grupos VIP e Elite
 * recebem atualizações a cada 2h.
 * GET /api/cron/modo-crise?acao=ativar|desativar|status
 * POST /api/cron/modo-crise — ativa automaticamente quando há 3+ notícias urgentes em 2h
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const acao = searchParams.get("acao") || "status";

  try {
    if (acao === "status") {
      const alerta = await sql`
        SELECT * FROM alertas
        WHERE tipo = 'modo_crise' AND resolvido = false
        ORDER BY created_at DESC LIMIT 1
      `;
      return NextResponse.json({ ativo: alerta.length > 0, alerta: alerta[0] || null });
    }

    if (acao === "ativar") {
      // Verifica se já está ativo
      const jaAtivo = await sql`
        SELECT id FROM alertas WHERE tipo = 'modo_crise' AND resolvido = false LIMIT 1
      `;
      if (jaAtivo.length > 0) {
        return NextResponse.json({ ok: true, motivo: "já está ativo" });
      }

      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES ('modo_crise', 'alto', 'Modo crise ativado manualmente')
      `;

      await alertarTelegram("🚨", "MODO CRISE ATIVADO", "Agente Márcio Crise ativou o modo de emergência. VIP receberá updates a cada 2h.");

      return NextResponse.json({ ok: true, acao: "ativado" });
    }

    if (acao === "desativar") {
      await sql`UPDATE alertas SET resolvido = true, resolvido_at = NOW() WHERE tipo = 'modo_crise' AND resolvido = false`;
      await alertarTelegram("🟢", "Modo Crise Desativado", "Situação normalizada.");
      return NextResponse.json({ ok: true, acao: "desativado" });
    }

    // Verificação automática: ativa se há 3+ urgentes nas últimas 2h
    if (acao === "verificar") {
      const urgentes = await sql`
        SELECT COUNT(*) as total FROM noticias
        WHERE urgente = true AND created_at >= NOW() - INTERVAL '2 hours'
      `;
      const total = Number(urgentes[0].total);

      if (total >= 3) {
        const jaAtivo = await sql`SELECT id FROM alertas WHERE tipo = 'modo_crise' AND resolvido = false LIMIT 1`;
        if (jaAtivo.length === 0) {
          // Auto-ativa
          try {
            const activateRes = await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/cron/modo-crise?acao=ativar`, {
              headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` },
              signal: AbortSignal.timeout(10000),
            });
            if (!activateRes.ok) {
              return NextResponse.json({ ok: false, ativadoAutomaticamente: false, urgentes: total, erro: `ativacao retornou ${activateRes.status}` });
            }
            return NextResponse.json({ ok: true, ativadoAutomaticamente: true, urgentes: total, modoAtivo: true });
          } catch (err) {
            await alertarTelegram("🔴", "Falha ao auto-ativar Modo Crise", String(err));
            return NextResponse.json({ ok: false, ativadoAutomaticamente: false, urgentes: total, erro: String(err) });
          }
        }
        return NextResponse.json({ ok: true, urgentes: total, modoAtivo: true });
      }

      return NextResponse.json({ ok: true, urgentes: total, modoAtivo: false });
    }

    return NextResponse.json({ erro: "Ação inválida" }, { status: 400 });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
