/**
 * AGENTE DIEGO DESISTENTES
 * Roda 1x/dia. Identifica cancelamentos dos últimos 30 dias
 * e passa para a Campanha de Recuperação.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const cancelados = await sql`
      SELECT u.id, u.nome, u.email, u.telefone, u.plano,
        EXTRACT(DAY FROM NOW() - u.updated_at)::int as dias_cancelado
      FROM usuarios u
      WHERE u.status = 'cancelado'
      AND u.updated_at >= NOW() - INTERVAL '30 days'
      AND u.id NOT IN (
        SELECT (detalhes->>'usuarioId')::int FROM agentes_log
        WHERE agente = 'diego-desistentes'
        AND created_at >= NOW() - INTERVAL '30 days'
      )
    `;

    for (const u of cancelados) {
      // Classifica motivo provável
      const motivo = u.dias_cancelado <= 7 ? 'preco_ou_expectativa'
        : u.dias_cancelado <= 14 ? 'conteudo_ou_frequencia'
        : 'esquecimento_ou_financeiro';

      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('diego-desistentes', 'identificar_cancelamento', 'sucesso',
          ${JSON.stringify({ usuarioId: u.id, nome: u.nome, email: u.email, telefone: u.telefone, plano: u.plano, motivo, dias_cancelado: u.dias_cancelado, iniciar_recuperacao: true })})
      `;
    }

    return NextResponse.json({ ok: true, cancelados: cancelados.length });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Diego Desistentes", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('diego-desistentes', 'identificar_cancelamento', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
