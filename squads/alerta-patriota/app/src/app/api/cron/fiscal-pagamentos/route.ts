/**
 * FISCAL FELIPE FISCAL — Verifica webhooks MP e checkout a cada hora
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Verifica se webhook MP está recebendo (ao menos 1 nas últimas 24h em produção com membros)
    const totalMembros = await sql`SELECT COUNT(*) as total FROM usuarios WHERE status = 'ativo'`;
    const qtdMembros = Number(totalMembros[0].total);

    // Se tem membros, espera ter pelo menos algum webhook nas últimas 24h
    const webhooksRecentes = await sql`
      SELECT COUNT(*) as total FROM agentes_log
      WHERE agente = 'augusto-assinaturas'
      AND created_at >= NOW() - INTERVAL '24 hours'
    `;
    const qtdWebhooks = Number(webhooksRecentes[0].total);

    // Pagamentos com status pendente há mais de 2h (indica problema no processamento)
    const pendentesMuitoTempo = await sql`
      SELECT COUNT(*) as total FROM pagamentos
      WHERE status = 'pendente'
      AND created_at <= NOW() - INTERVAL '2 hours'
    `;
    const qtdPendentes = Number(pendentesMuitoTempo[0].total);

    if (qtdPendentes > 0) {
      const { criado } = await criarAlertaDedup("fiscal_pagamentos_pendentes", "medio", `${qtdPendentes} pagamento(s) parado(s) há +2h`);
      if (criado) {
        await alertarTelegram("🟡", "Fiscal Felipe — Pagamentos pendentes há +2h", `${qtdPendentes} pagamento(s) parado(s). Verificar painel MP.`);
      }
    }

    // Sinal de alerta (não conclusivo): se há membros ativos mas nenhum log de
    // assinatura nas últimas 24h, pode indicar webhook MP fora do ar — mas também
    // é normal em dias sem novas assinaturas/renovações, por isso severidade baixa.
    if (qtdMembros > 0 && qtdWebhooks === 0) {
      const { criado } = await criarAlertaDedup("fiscal_pagamentos_sem_atividade", "baixo", `${qtdMembros} membro(s) ativo(s) sem log de assinatura em 24h`);
      if (criado) {
        await alertarTelegram("🟡", "Fiscal Felipe — Sem atividade de assinaturas em 24h", `${qtdMembros} membro(s) ativo(s), mas nenhum log de 'augusto-assinaturas' nas últimas 24h. Pode ser normal ou indicar webhook MP fora do ar.`);
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('felipe-fiscal', 'verificar_pagamentos', 'sucesso',
        ${JSON.stringify({ qtdMembros, qtdWebhooks24h: qtdWebhooks, qtdPendentes })})
    `;

    return NextResponse.json({ ok: true, qtdMembros, qtdWebhooks24h: qtdWebhooks, qtdPendentes });
  } catch (err) {
    const { criado } = await criarAlertaDedup("fiscal_pagamentos_erro", "alto", String(err)).catch(() => ({ criado: false }));
    if (criado) {
      await alertarTelegram("🔴", "Fiscal Felipe — ERRO", String(err));
    }
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
