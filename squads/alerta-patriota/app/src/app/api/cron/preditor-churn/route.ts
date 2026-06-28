/**
 * AGENTE RODRIGO RISCO — Preditor de Churn
 * Roda 1x/dia. Pontua usuários de 0-100 por risco de cancelamento.
 * Score > 70: aciona oferta especial antes de cancelarem.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemPrivada } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

function calcularScore(u: {
  dias_sem_atividade: number;
  status: string;
  plano: string;
  dias_assinante: number;
}): number {
  let score = 0;
  if (u.dias_sem_atividade > 20) score += 40;
  else if (u.dias_sem_atividade > 10) score += 20;
  else if (u.dias_sem_atividade > 5) score += 10;
  if (u.status === "inadimplente") score += 30;
  if (u.dias_assinante < 30) score += 10;
  return Math.min(score, 100);
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const usuarios = await sql`
      SELECT id, nome, telefone, plano, status,
        EXTRACT(DAY FROM NOW() - updated_at)::int as dias_sem_atividade,
        EXTRACT(DAY FROM NOW() - assinatura_inicio)::int as dias_assinante
      FROM usuarios
      WHERE status IN ('ativo', 'inadimplente')
      AND telefone IS NOT NULL
    `;

    let alertados = 0;

    for (const u of usuarios) {
      const score = calcularScore({
        dias_sem_atividade: u.dias_sem_atividade || 0,
        status: u.status,
        plano: u.plano,
        dias_assinante: u.dias_assinante || 0,
      });

      if (score >= 70) {
        // Verifica se já foi alertado com sucesso nas últimas 72h — FASE 27.5: sem o
        // filtro status='sucesso', uma falha de envio bloqueava qualquer nova tentativa
        // de alertar aquele usuário de alto risco por 3 dias inteiros (mesmo bug de
        // engajamento.ts/upgrade-comportamental.ts, já corrigido em campanha-recuperacao.ts).
        const jaAlertado = await sql`
          SELECT id FROM agentes_log
          WHERE agente = 'rodrigo-risco' AND status = 'sucesso' AND detalhes->>'usuarioId' = ${String(u.id)}
          AND created_at >= NOW() - INTERVAL '72 hours'
          LIMIT 1
        `;
        if (jaAlertado.length > 0) continue;

        const msg = `💛 *${u.nome}, não nos abandone!*\n\nPercebemos que você pode estar pensando em sair do Alerta Patriota. Antes de ir, queremos te oferecer algo especial.\n\nFale com a gente: ${APP_URL}/assinar\n\n_Capitão Braga — Deus, Pátria e Família._`;
        // FASE 23: status 'sucesso' era gravado incondicionalmente, mascarando falhas reais
        // de envio do alerta de churn.
        const enviado = await enviarMensagemPrivada(u.telefone, msg, u.plano);

        await sql`
          INSERT INTO agentes_log (agente, acao, status, detalhes)
          VALUES ('rodrigo-risco', 'alerta_churn', ${enviado ? "sucesso" : "erro"}, ${JSON.stringify({ usuarioId: u.id, score, plano: u.plano })})
        `;
        alertados++;
        // FASE 30: este loop podia disparar dezenas de mensagens privadas em sequência sem
        // nenhuma pausa, risco de ban da instância Evolution API por padrão de envio em massa
        // — mesmo delay já usado em upgrade-comportamental.ts para o mesmo tipo de envio.
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    return NextResponse.json({ ok: true, verificados: usuarios.length, alertados });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Rodrigo Risco", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
