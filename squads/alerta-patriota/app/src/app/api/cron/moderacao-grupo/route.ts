/**
 * AGENTE MIGUEL MODERAÇÃO
 * Roda 1x/dia. Remove do grupo WhatsApp membros com assinatura cancelada/inadimplente.
 * Remove inativos há +60 dias sem atividade.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { removerMembroGrupo } from "@/lib/whatsapp";
import type { Plano } from "@/lib/db";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    let removidos = 0;

    // 1. Remove membros com assinatura cancelada/inadimplente há mais de 3 dias
    const cancelados = await sql`
      SELECT u.id, u.telefone, u.plano, u.status
      FROM usuarios u
      WHERE u.status IN ('cancelado', 'inadimplente')
      AND u.updated_at <= NOW() - INTERVAL '3 days'
      AND u.telefone IS NOT NULL
      AND EXISTS (
        SELECT 1 FROM membros_grupos mg
        JOIN grupos_whatsapp g ON g.id = mg.grupo_id
        WHERE mg.usuario_id = u.id AND mg.status = 'ativo'
      )
    `;

    for (const u of cancelados) {
      if (!u.plano) continue;
      // FASE 17: antes não checava o retorno da remoção — o banco marcava
      // 'removido' e decrementava membros_ativos mesmo quando a chamada real
      // à Evolution API falhava, deixando o usuário cancelado/inadimplente
      // com acesso ao grupo pago enquanto o sistema achava que já tinha sido
      // removido (sem retry futuro, já que o status deixava de bater com a
      // condição EXISTS acima).
      const removido = await removerMembroGrupo(u.telefone, u.plano as Plano);

      if (!removido) {
        await sql`
          INSERT INTO agentes_log (agente, acao, status, detalhes)
          VALUES ('miguel-moderacao', 'remover_cancelado', 'erro',
            ${JSON.stringify({ usuarioId: u.id, plano: u.plano, motivo: u.status, erro: "Evolution API recusou a remoção" })})
        `;
        await new Promise(r => setTimeout(r, 1500));
        continue;
      }

      await sql`
        UPDATE membros_grupos SET status = 'removido', data_saida = NOW()
        WHERE usuario_id = ${u.id} AND status = 'ativo'
      `;
      await sql`
        UPDATE grupos_whatsapp SET membros_ativos = GREATEST(0, membros_ativos - 1)
        WHERE plano = ${u.plano}
      `;
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('miguel-moderacao', 'remover_cancelado', 'sucesso',
          ${JSON.stringify({ usuarioId: u.id, plano: u.plano, motivo: u.status })})
      `;
      removidos++;
      await new Promise(r => setTimeout(r, 1500));
    }

    return NextResponse.json({ ok: true, removidos });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Miguel Moderação", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('miguel-moderacao', 'remover_cancelado', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
