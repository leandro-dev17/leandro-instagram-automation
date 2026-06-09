/**
 * LIMPADOR LEONTINO — Limpador de Dados (Housekeeping Semanal)
 * Remove registros obsoletos para manter performance do banco.
 * Executa aos domingos: push subscriptions inativas, falhas resolvidas antigas, fila processada.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const operacoes: string[] = [];

    // 1. Remove push subscriptions inativas há mais de 90 dias
    const pushInativas = await sql`
      DELETE FROM push_subscriptions
      WHERE ativo = false
        AND criado_em < NOW() - INTERVAL '90 days'
      RETURNING id
    `;
    if (pushInativas.length > 0) {
      operacoes.push(`Removidas ${pushInativas.length} push subscriptions inativas (>90 dias)`);
    }

    // 2. Remove falhas resolvidas com mais de 30 dias
    const falhasAntigas = await sql`
      DELETE FROM falhas_agentes
      WHERE resolvido = true
        AND resolvido_em < NOW() - INTERVAL '30 days'
      RETURNING id
    `;
    if (falhasAntigas.length > 0) {
      operacoes.push(`Removidas ${falhasAntigas.length} falhas resolvidas antigas (>30 dias)`);
    }

    // 3. Remove itens da fila WhatsApp já enviados há mais de 15 dias
    const filaAntiga = await sql`
      DELETE FROM whatsapp_fila
      WHERE status = 'enviado'
        AND enviado_em < NOW() - INTERVAL '15 days'
      RETURNING id
    `.catch(() => ({ length: 0 }));
    if ((filaAntiga as { id: number }[]).length > 0) {
      operacoes.push(`Removidos ${(filaAntiga as { id: number }[]).length} registros da fila WhatsApp enviada`);
    }

    // 4. Remove chaves de controle (app_configuracoes) antigas de onboarding/trial (>60 dias)
    const chavesAntigas = await sql`
      DELETE FROM app_configuracoes
      WHERE (chave LIKE 'onboarding_%' OR chave LIKE 'trial_notificado_%'
          OR chave LIKE 'conversor_%' OR chave LIKE 'desistente_contatado_%')
        AND CAST(valor AS TIMESTAMPTZ) < NOW() - INTERVAL '60 days'
      RETURNING id
    `.catch(() => ({ length: 0 }));
    if ((chavesAntigas as { id: number }[]).length > 0) {
      operacoes.push(`Removidas ${(chavesAntigas as { id: number }[]).length} chaves de controle obsoletas`);
    }

    // 5. Remove planos semanais com mais de 8 semanas
    const planosAntigos = await sql`
      DELETE FROM planos_semanais
      WHERE semana < (CURRENT_DATE - INTERVAL '56 days')::text
      RETURNING id
    `;
    if (planosAntigos.length > 0) {
      operacoes.push(`Removidos ${planosAntigos.length} slots de planos semanais antigos (>8 semanas)`);
    }

    if (operacoes.length > 0) {
      await enviarTelegram(
        `🧹 <b>Limpador de Dados — Relatório Semanal</b>\n\n` +
        operacoes.map(o => `  ✅ ${o}`).join("\n") +
        `\n\n<i>Housekeeping concluído. Banco de dados otimizado!</i>`
      );
    }

    await resolverFalhas("limpador-dados");
    return NextResponse.json({ ok: true, operacoes });
  } catch (err) {
    await reportarFalha("limpador-dados", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
