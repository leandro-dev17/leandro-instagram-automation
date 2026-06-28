/**
 * RECONCILIADOR PIX (FASE 33)
 * Consulta diretamente a API do Mercado Pago para pagamentos PIX que ficaram
 * 'pendente' por muito tempo — cobre o caso em que o webhook nunca chegou
 * (rede instável, MP fora do ar, erro no banco) e o cliente pagou sem nunca
 * ter o acesso ativado, ou o PIX expirou e o registro nunca foi atualizado.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { MercadoPagoConfig, Payment } from "mercadopago";
import { ativarAcesso } from "@/lib/mp-ativar-acesso";
import type { Plano } from "@/lib/db";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // PIX no Mercado Pago expira em poucas horas — após 3h ainda 'pendente' no banco,
    // ou o webhook falhou (cliente pagou e nunca recebeu acesso) ou o PIX expirou sem
    // pagamento. Janela de 7 dias evita reconsultar pagamentos antigos demais para
    // ainda fazer sentido reativar automaticamente.
    const pendentes = await sql`
      SELECT id, usuario_id, valor, mp_payment_id, cupom
      FROM pagamentos
      WHERE status = 'pendente' AND metodo = 'pix' AND mp_payment_id IS NOT NULL
        AND created_at <= NOW() - INTERVAL '3 hours'
        AND created_at >= NOW() - INTERVAL '7 days'
      LIMIT 50
    `;

    const paymentClient = new Payment(client);
    let reconciliados = 0;
    let expirados = 0;
    let erros = 0;

    for (const p of pendentes) {
      try {
        const payment = await paymentClient.get({ id: p.mp_payment_id });

        if (payment.status === "approved") {
          const meta = payment.metadata as { usuario_id?: number; plano?: string; ciclo?: string } | undefined;
          const plano = (meta?.plano || "") as Plano;
          const ciclo: "mensal" | "anual" = meta?.ciclo === "anual" ? "anual" : "mensal";

          if (["vip", "elite"].includes(plano)) {
            await ativarAcesso(p.usuario_id, plano, p.mp_payment_id, Number(p.valor), ciclo, p.mp_payment_id, "pix", p.cupom || undefined);
            reconciliados++;
            await alertarTelegram(
              "🟢",
              "PIX reconciliado — webhook não tinha confirmado",
              `usuarioId: ${p.usuario_id} | mp_payment_id: ${p.mp_payment_id} | valor: R$ ${p.valor}\nO Mercado Pago já tinha aprovado este pagamento, mas o webhook nunca chegou ou falhou. Acesso ativado agora pelo reconciliador.`
            );
          } else {
            erros++;
            await alertarTelegram("🔴", "PIX aprovado mas sem plano válido no metadata", `usuarioId: ${p.usuario_id} | mp_payment_id: ${p.mp_payment_id} — verifique manualmente.`);
          }
        } else if (["rejected", "cancelled"].includes(payment.status || "")) {
          // PIX expirou sem pagamento ou foi rejeitado — para de poluir os alertas de "+2h pendente".
          await sql`UPDATE pagamentos SET status = 'rejeitado' WHERE id = ${p.id}`;
          expirados++;
        }
        // status "pending"/"in_process" no MP → ainda dentro da janela normal, não faz nada.
      } catch (err) {
        erros++;
        console.error("[reconciliador-pix] erro ao consultar payment", p.mp_payment_id, err);
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('reconciliador-pix', 'reconciliar', 'sucesso',
        ${JSON.stringify({ total: pendentes.length, reconciliados, expirados, erros })})
    `;

    if (erros > 0) {
      await alertarTelegram("🟡", "Reconciliador PIX — erros ao consultar MP", `${erros} pagamento(s) com erro na consulta — ver logs.`);
    }

    return NextResponse.json({ ok: true, total: pendentes.length, reconciliados, expirados, erros });
  } catch (err) {
    console.error("reconciliador-pix error:", err);
    await alertarTelegram("🔴", "Reconciliador PIX — ERRO", String(err)).catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
