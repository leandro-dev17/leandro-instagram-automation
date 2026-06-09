/**
 * REVISOR MARCO MÉTODO — Revisor de Lógica
 * Lê alertas do fiscal-codigo-logica e aplica correções automáticas de lógica de negócio.
 * Auto-fixes: status trial, fila WhatsApp, limite favoritos.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const alertas = await sql`
      SELECT id, erro FROM falhas_agentes
      WHERE agente = 'fiscal-codigo-logica' AND resolvido = false
      ORDER BY criado_em DESC LIMIT 20
    ` as { id: number; erro: string }[];

    if (alertas.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas de lógica pendentes" });
    }

    const acoes: string[] = [];

    for (const alerta of alertas) {
      const erro = alerta.erro;

      // Auto-fix: atualiza usuarios com trial expirado para free
      if (erro.includes("trial expirado") || erro.includes("tipo_usuario ainda = 'trial'")) {
        const atualizados = await sql`
          UPDATE usuarios SET tipo_usuario = 'free'
          WHERE tipo_usuario = 'trial' AND trial_fim < NOW()
          RETURNING id
        `;
        if (atualizados.length > 0) {
          acoes.push(`Atualizados ${atualizados.length} usuário(s) trial expirado → free`);
        }
      }

      // Auto-fix: fila WhatsApp represada → reaciona processador
      if (erro.includes("Fila WhatsApp represada") || erro.includes("mensagens pendentes há >2h")) {
        fetch(`${APP}/api/cron/whatsapp-fila`, {
          headers: { Authorization: `Bearer ${CRON}` },
          signal: AbortSignal.timeout(5000),
        }).catch(() => {});
        acoes.push("Processador de fila WhatsApp reacionado");
      }

      // Auto-fix: status inválido em assinaturas ('ativa' → 'ativo')
      if (erro.includes("status inválido") && erro.includes("ativa")) {
        const corrigidas = await sql`
          UPDATE assinaturas SET status = 'ativo' WHERE status = 'ativa' RETURNING id
        `;
        if (corrigidas.length > 0) {
          acoes.push(`Corrigidas ${corrigidas.length} assinaturas de 'ativa' → 'ativo'`);
        }
        const corrigidas2 = await sql`
          UPDATE assinaturas SET status = 'cancelado' WHERE status = 'cancelada' RETURNING id
        `;
        if (corrigidas2.length > 0) {
          acoes.push(`Corrigidas ${corrigidas2.length} assinaturas de 'cancelada' → 'cancelado'`);
        }
      }

      // Auto-fix: remove favoritos excedentes de usuários free (máx 5)
      if (erro.includes("usuário(s) free com >5 favoritos")) {
        const excedentes = await sql`
          SELECT f.id FROM favoritos f
          JOIN usuarios u ON u.id = f.usuario_id
          WHERE u.tipo_usuario = 'free'
          AND f.id NOT IN (
            SELECT f2.id FROM favoritos f2
            WHERE f2.usuario_id = f.usuario_id
            ORDER BY f2.criado_em ASC
            LIMIT 5
          )
          LIMIT 100
        ` as { id: number }[];
        if (excedentes.length > 0) {
          const ids = excedentes.map(e => e.id);
          await sql`DELETE FROM favoritos WHERE id = ANY(${ids})`;
          acoes.push(`Removidos ${excedentes.length} favoritos excedentes de usuários free`);
        }
      }

      await sql`UPDATE falhas_agentes SET resolvido = true, resolvido_em = NOW() WHERE id = ${alerta.id}`;
    }

    // Sempre escala para gerente-codigo
    fetch(`${APP}/api/cron/gerente-codigo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ origem: "revisor-logica", acoes }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    await enviarTelegram(
      `⚙️ <b>Revisor Lógica — Relatório</b>\n\n` +
      `🔧 Ações executadas (${acoes.length}):\n${acoes.map(a => `  ✅ ${a}`).join("\n") || "  nenhuma ação automática disponível"}\n\n` +
      `📊 Gerente de Código acionado para consolidação.`
    );

    return NextResponse.json({ ok: true, acoes });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
