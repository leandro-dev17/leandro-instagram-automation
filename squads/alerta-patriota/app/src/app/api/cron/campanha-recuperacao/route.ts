/**
 * AGENTE REBECA RECUPERAÇÃO
 * Sequência automática de 30 dias para quem cancelou.
 * D1 email, D3 WPP, D7 email, D10 WPP, D15 email, D20 WPP, D25 email, D30 WPP.
 * Para automaticamente se assinar novamente.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { enviarMensagemPrivada } from "@/lib/whatsapp";
import { enviarEmailRecuperacao } from "@/lib/brevo";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

const SEQUENCIA: Record<number, { canal: "email" | "whatsapp"; msg: string }> = {
  1:  { canal: "email",     msg: "1" },
  3:  { canal: "whatsapp",  msg: "3" },
  7:  { canal: "email",     msg: "7" },
  10: { canal: "whatsapp",  msg: "10" },
  15: { canal: "email",     msg: "15" },
  20: { canal: "whatsapp",  msg: "20" },
  25: { canal: "email",     msg: "25" },
  30: { canal: "whatsapp",  msg: "30" },
};

const MSGS_WPP: Record<string, (nome: string) => string> = {
  "3":  (nome: string) => `🇧🇷 *${nome}, o Brasil continua precisando de você!*\n\nVoltou muita coisa importante desde que você saiu. Nikolas falou, o STF decidiu, o Congresso votou — e você não estava por aqui.\n\nVolte agora por R$1: ${APP_URL}/assinar\n\n_Capitão Braga — Deus, Pátria e Família._`,
  "10": (nome: string) => `⚡ *${nome}, oferta especial para você voltar!*\n\nSabemos que a vida é corrida. Por isso estamos com uma condição especial exclusiva para quem já foi do grupo.\n\nAproveite: ${APP_URL}/assinar\n\n_Deus, Pátria e Família — sempre._`,
  "20": (nome: string) => `🔥 *${nome}, última chamada!*\n\nO grupo está no maior movimento dos últimos meses. Você está perdendo muito.\n\nÚltima chance: ${APP_URL}/assinar`,
  "30": (nome: string) => `💛 *${nome}, sentimos sua falta.*\n\nSe um dia quiser voltar, estaremos aqui. O Alerta Patriota continua de pé, firme e sem filtro.\n\n${APP_URL}/assinar`,
};

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Busca cancelamentos identificados pelo Diego Desistentes, recalculando
    // dias_cancelado a partir de usuarios.updated_at (o valor gravado no log fica
    // congelado no dia da detecção e nunca bateria nas etapas da SEQUENCIA)
    const pendentes = await sql`
      SELECT l.detalhes, EXTRACT(DAY FROM NOW() - u.updated_at)::int as dias_cancelado_atual
      FROM agentes_log l
      JOIN usuarios u ON u.id = (l.detalhes->>'usuarioId')::int
      WHERE l.agente = 'diego-desistentes' AND l.acao = 'identificar_cancelamento'
      AND (l.detalhes->>'iniciar_recuperacao')::boolean = true
      AND u.status = 'cancelado'
      AND u.updated_at >= NOW() - INTERVAL '30 days'
    `;

    let enviados = 0;

    for (const p of pendentes) {
      const d = p.detalhes as Record<string, unknown>;
      const usuarioId = d.usuarioId as number;
      const diasCancelado = p.dias_cancelado_atual as number;
      const etapa = SEQUENCIA[diasCancelado];

      if (!etapa) continue;

      // Verifica se já enviou com sucesso neste dia — checar só por status='sucesso'
      // permite retentar nas próximas execuções (cron roda a cada 30min) quando o
      // envio anterior falhou, em vez de marcar como enviado mesmo tendo falhado.
      const jaEnviou = await sql`
        SELECT id FROM agentes_log
        WHERE agente = 'rebeca-recuperacao' AND status = 'sucesso'
        AND detalhes->>'usuarioId' = ${String(usuarioId)}
        AND detalhes->>'dia' = ${String(diasCancelado)}
        LIMIT 1
      `;
      if (jaEnviou.length > 0) continue;

      const nome = d.nome as string;
      const email = d.email as string;
      const telefone = d.telefone as string;

      // FASE 24: no branch de e-mail, `enviado` nunca era atualizado a partir do retorno
      // real de enviarEmailRecuperacao() — ficava sempre `true`, mascarando falhas reais
      // do Brevo e impedindo qualquer retentativa (a dedup acima só repete quando não há
      // log com status='sucesso'). Mesma classe de bug já corrigida no lado WhatsApp.
      let enviado = true;
      if (etapa.canal === "email") {
        enviado = await enviarEmailRecuperacao(email, nome, diasCancelado).catch(() => false);
      } else if (telefone && MSGS_WPP[etapa.msg]) {
        enviado = await enviarMensagemPrivada(telefone, MSGS_WPP[etapa.msg](nome));
      } else {
        enviado = false; // sem telefone cadastrado para o canal whatsapp
      }

      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('rebeca-recuperacao', 'enviar_recuperacao', ${enviado ? "sucesso" : "erro"},
          ${JSON.stringify({ usuarioId, dia: diasCancelado, canal: etapa.canal })})
      `;
      if (enviado) enviados++;
    }

    return NextResponse.json({ ok: true, enviados });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Rebeca Recuperação", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('rebeca-recuperacao', 'enviar_recuperacao', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
