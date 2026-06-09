import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "fiscal-pagamentos");
  if (!auth.ok) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const alertas: string[] = [];

  try {
    // 1. Usuários premium sem assinatura ativa (receberam premium mas não há registro de assinatura)
    const premiumSemAssinatura = await sql`
      SELECT u.id, u.email, u.tipo_usuario
      FROM usuarios u
      WHERE u.tipo_usuario = 'premium'
        AND NOT EXISTS (
          SELECT 1 FROM assinaturas a
          WHERE a.usuario_id = u.id AND a.status = 'ativo'
        )
    `;
    if (premiumSemAssinatura.length > 0) {
      alertas.push(`👑 ${premiumSemAssinatura.length} usuários premium sem assinatura ativa no banco`);
      await reportarFalha(
        "fiscal-pagamentos",
        `${premiumSemAssinatura.length} usuários com tipo_usuario=premium mas sem assinaturas.status=ativo`,
        { tipo: "inconsistencia_premium", severidade: "alta" }
      );
    }

    // 2. Assinaturas ativas sem usuário premium correspondente (pagamento registrado mas usuário não atualizado)
    const assinaturaSemPremium = await sql`
      SELECT a.id, a.usuario_id, a.mp_preapproval_id
      FROM assinaturas a
      JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.status = 'ativo'
        AND u.tipo_usuario NOT IN ('premium', 'admin', 'aluna_leandro')
    `;
    if (assinaturaSemPremium.length > 0) {
      alertas.push(`💳 ${assinaturaSemPremium.length} assinaturas ativas com usuário não-premium (pagamento não aplicado)`);

      // Auto-corrige: promove usuários com assinatura ativa para premium
      await sql`
        UPDATE usuarios u
        SET tipo_usuario = 'premium'
        FROM assinaturas a
        WHERE a.usuario_id = u.id
          AND a.status = 'ativo'
          AND u.tipo_usuario NOT IN ('premium', 'admin', 'aluna_leandro')
      `;
      alertas.push(`✅ Auto-correção aplicada: ${assinaturaSemPremium.length} usuários promovidos para premium`);
    }

    // 3. Assinaturas ativas sem renovação há mais de 35 dias (podem estar lapsed)
    const assinaturasLapsed = await sql`
      SELECT a.id, a.usuario_id, a.renovada_em, a.plano
      FROM assinaturas a
      WHERE a.status = 'ativo'
        AND a.renovada_em < NOW() - INTERVAL '35 days'
    `;
    if (assinaturasLapsed.length > 0) {
      alertas.push(`⏰ ${assinaturasLapsed.length} assinaturas ativas sem renovação há +35 dias (verificar no MP)`);
      await reportarFalha(
        "fiscal-pagamentos",
        `${assinaturasLapsed.length} assinaturas sem renovação há mais de 35 dias`,
        { tipo: "renovacao_atrasada", severidade: "media" }
      );
    }

    // 4. Trials vencidos que ainda aparecem como trial (deveriam ter sido rebaixados)
    const trialsVencidosPendentes = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
      WHERE tipo_usuario = 'trial' AND trial_fim < NOW()
    `;
    const qtdTrialVencido = trialsVencidosPendentes[0].total;
    if (qtdTrialVencido > 0) {
      alertas.push(`🕐 ${qtdTrialVencido} usuários com trial vencido ainda marcados como trial`);
      // Auto-corrige imediatamente
      await sql`
        UPDATE usuarios SET tipo_usuario = 'free'
        WHERE tipo_usuario = 'trial' AND trial_fim < NOW()
      `;
      alertas.push(`✅ Auto-correção: ${qtdTrialVencido} trials vencidos rebaixados para free`);
    }

    // 5. Usuários cancelados ainda marcados como premium
    const premiumCancelados = await sql`
      SELECT COUNT(*)::int AS total
      FROM usuarios u
      WHERE u.tipo_usuario = 'premium'
        AND EXISTS (
          SELECT 1 FROM assinaturas a
          WHERE a.usuario_id = u.id
            AND a.status = 'cancelado'
            AND NOT EXISTS (
              SELECT 1 FROM assinaturas a2
              WHERE a2.usuario_id = u.id AND a2.status = 'ativo'
            )
        )
    `;
    const qtdPremiumCancelados = premiumCancelados[0].total;
    if (qtdPremiumCancelados > 0) {
      alertas.push(`🚫 ${qtdPremiumCancelados} usuários premium com assinatura cancelada (sem assinatura ativa)`);
      await sql`
        UPDATE usuarios u
        SET tipo_usuario = 'free'
        WHERE u.tipo_usuario = 'premium'
          AND EXISTS (
            SELECT 1 FROM assinaturas a
            WHERE a.usuario_id = u.id AND a.status = 'cancelado'
          )
          AND NOT EXISTS (
            SELECT 1 FROM assinaturas a2
            WHERE a2.usuario_id = u.id AND a2.status = 'ativo'
          )
      `;
      alertas.push(`✅ Auto-correção: ${qtdPremiumCancelados} usuários rebaixados para free`);
    }

    if (alertas.length > 0) {
      const data = new Date().toLocaleDateString("pt-BR");
      await enviarTelegram(
        `💳 <b>Fiscal de Pagamentos — ${data}</b>\n\n` +
        alertas.map((a) => `• ${a}`).join("\n")
      );
    }

    await resolverFalhas("fiscal-pagamentos");

    return NextResponse.json({
      ok: true,
      alertas: alertas.length,
      detalhes: alertas,
      premium_sem_assinatura: premiumSemAssinatura.length,
      assinatura_sem_premium: assinaturaSemPremium.length,
      assinaturas_lapsed: assinaturasLapsed.length,
      trials_vencidos_corrigidos: qtdTrialVencido,
      premium_cancelados_corrigidos: qtdPremiumCancelados,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-pagamentos] Erro:", mensagem);
    await reportarFalha("fiscal-pagamentos", mensagem);
    return NextResponse.json({ erro: mensagem }, { status: 500 });
  }
}
