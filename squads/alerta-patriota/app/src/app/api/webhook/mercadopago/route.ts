/**
 * AGENTE AUGUSTO ASSINATURAS
 * Webhook do Mercado Pago — processa pagamentos, renovações e cancelamentos.
 * Ativa/desativa acesso ao grupo WhatsApp automaticamente.
 */

import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoConfig, Payment, PreApproval } from "mercadopago";
import { alertarTelegram } from "@/lib/telegram";
import { ativarAcesso } from "@/lib/mp-ativar-acesso";
import { desativarAcesso, renovarAcesso } from "@/lib/mp-desativar-acesso";
import { validarAssinaturaWebhook } from "@/lib/mp-webhook-hmac";
import { sql } from "@/lib/db";
import type { Plano } from "@/lib/db";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

// ─── VALIDAÇÃO HMAC ────────────────────────────────────────────────────────────
// Lógica de validação (manifests + comparação HMAC) movida para lib/mp-webhook-hmac.ts
// (FASE 38 — testabilidade, mesmo motivo de lib/texto.ts na FASE 37).

async function validarWebhook(req: NextRequest): Promise<boolean> {
  const xSignature = req.headers.get("x-signature");
  const valido = await validarAssinaturaWebhook({
    secret: process.env.MERCADOPAGO_WEBHOOK_SECRET,
    xSignature,
    xRequestId: req.headers.get("x-request-id"),
    dataId: new URL(req.url).searchParams.get("data.id") || "",
  });

  if (!xSignature) {
    console.log("[webhook-mp] Sem x-signature — aceitando sem validação HMAC");
  } else if (!process.env.MERCADOPAGO_WEBHOOK_SECRET) {
    console.error("[webhook-mp] x-signature presente mas MERCADOPAGO_WEBHOOK_SECRET não configurada");
  } else {
    console.log(valido ? "[webhook-mp] HMAC válido ✓" : "[webhook-mp] HMAC inválido");
  }

  return valido;
}

// ─── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    console.log("[webhook-mp] Recebido — url:", req.url, "| x-signature:", req.headers.get("x-signature")?.substring(0, 40) || "AUSENTE");

    if (!(await validarWebhook(req))) {
      console.error("[webhook-mp] Validação falhou — descartando evento");
      return NextResponse.json({ ok: true }); // 200 para MP não retentar
    }

    const body = JSON.parse(rawBody);
    const tipo = body.type as string;
    const dataId = body.data?.id as string | undefined;
    console.log("[webhook-mp] tipo:", tipo, "| dataId:", dataId);
    if (!dataId) return NextResponse.json({ ok: true });

    // Rate limiting: rejeita o mesmo dataId processado nos últimos 5 minutos
    const jaProcessado = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'augusto-assinaturas'
        AND (detalhes->>'dataId') = ${dataId}
        AND created_at > NOW() - INTERVAL '5 minutes'
      LIMIT 1
    `.catch(() => []);
    if (jaProcessado.length > 0) {
      console.log("[webhook-mp] Duplicata ignorada — dataId:", dataId);
      return NextResponse.json({ ok: true, motivo: "duplicata ignorada" });
    }

    if (tipo === "subscription_preapproval") {
      const preApprovalClient = new PreApproval(client);
      const pa = await preApprovalClient.get({ id: dataId });
      console.log("[webhook-mp] preapproval status:", pa.status, "| external_reference:", pa.external_reference);

      if (pa.status === "authorized") {
        // external_reference: "usuarioId|plano|ciclo" ou "usuarioId|plano|ciclo|CUPOM"
        const partes = (pa.external_reference || "").split("|");
        const usuarioId = parseInt(partes[0]);
        const plano = (partes[1] || "vip") as Plano;
        const ciclo = (partes[2] || "mensal") as "mensal" | "anual";
        const cupom = partes[3] || undefined;
        const valor = (pa.auto_recurring as { transaction_amount?: number })?.transaction_amount ?? 0;
        console.log("[webhook-mp] Ativando acesso — usuarioId:", usuarioId, "| plano:", plano, "| ciclo:", ciclo, "| valor:", valor, "| cupom:", cupom || "(nenhum)");

        if (usuarioId && !isNaN(usuarioId) && ["vip","elite"].includes(plano)) {
          if (!valor || isNaN(valor) || valor <= 0) {
            console.error("[webhook-mp] valor inválido — acesso NÃO ativado. usuarioId:", usuarioId, "| valor:", valor);
            await alertarTelegram("🔴", "Webhook MP — valor inválido, acesso NÃO ativado", `usuarioId: ${usuarioId} | plano: ${plano} | valor recebido: ${valor} | dataId: ${dataId}`);
          } else {
            await ativarAcesso(usuarioId, plano, dataId, valor, ciclo, undefined, "desconhecido", cupom);
            console.log("[webhook-mp] ativarAcesso concluído para usuarioId:", usuarioId);
          }
        } else {
          console.error("[webhook-mp] Dados inválidos — usuarioId:", usuarioId, "| plano:", plano);
        }
      } else if (["cancelled"].includes(pa.status || "")) {
        await desativarAcesso(dataId, "cancelado");
      } else if (["paused"].includes(pa.status || "")) {
        await desativarAcesso(dataId, "inadimplente");
      }

    } else if (tipo === "subscription_authorized_payment") {
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });
      const preapprovalId = (payment as unknown as Record<string, unknown>).preapproval_id as string | undefined;

      if (payment.status === "approved" && preapprovalId) {
        const valor = payment.transaction_amount;
        if (!valor || isNaN(valor) || valor <= 0) {
          console.error("[webhook-mp] valor inválido na renovação — NÃO registrado. preapprovalId:", preapprovalId, "| valor:", valor);
          await alertarTelegram("🔴", "Webhook MP — valor inválido na renovação", `preapprovalId: ${preapprovalId} | valor recebido: ${valor} | dataId: ${dataId}`);
        } else {
          await renovarAcesso(preapprovalId, String(dataId), valor);
        }
      } else if (["rejected", "cancelled"].includes(payment.status || "") && preapprovalId) {
        await desativarAcesso(preapprovalId, "inadimplente");
      }

    } else if (tipo === "payment") {
      // Pagamento via Checkout Pro (Preference) ou PIX avulso
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });

      if (payment.status === "approved") {
        const meta = payment.metadata as { usuario_id?: number; plano?: string; ciclo?: string } | undefined;

        // Tenta metadata primeiro; fallback para external_reference ("usuarioId|plano|ciclo")
        let usuarioId: number | undefined = meta?.usuario_id ? Number(meta.usuario_id) : undefined;
        let plano = (meta?.plano || "") as Plano;
        let ciclo: "mensal" | "anual" = meta?.ciclo === "anual" ? "anual" : "mensal";

        if (!usuarioId && payment.external_reference) {
          const partes = (payment.external_reference as string).split("|");
          usuarioId = parseInt(partes[0]);
          plano = (partes[1] || "") as Plano;
          ciclo = partes[2] === "anual" ? "anual" : "mensal";
        }

        if (usuarioId && !isNaN(usuarioId) && ["vip", "elite"].includes(plano)) {
          const valor = payment.transaction_amount;
          if (!valor || isNaN(valor) || valor <= 0) {
            console.error("[webhook-mp] valor inválido — acesso NÃO ativado. usuarioId:", usuarioId, "| valor:", valor);
            await alertarTelegram("🔴", "Webhook MP — valor inválido, acesso NÃO ativado", `usuarioId: ${usuarioId} | plano: ${plano} | valor recebido: ${valor} | dataId: ${dataId}`);
          } else {
            await ativarAcesso(usuarioId, plano, String(dataId), valor, ciclo, String(dataId), payment.payment_type_id || "desconhecido");
          }
        } else {
          // FASE 23: pagamento aprovado no MP mas sem usuarioId/plano válido (metadata e
          // external_reference ausentes/corrompidos) — antes isso era descartado em silêncio,
          // sem log nem alerta, e o cliente pagava sem nunca ter o acesso ativado.
          console.error("[webhook-mp] payment aprovado mas dados inválidos — acesso NÃO ativado. usuarioId:", usuarioId, "| plano:", plano, "| dataId:", dataId);
          await alertarTelegram("🔴", "Webhook MP — payment aprovado com dados inválidos, acesso NÃO ativado", `usuarioId: ${usuarioId} | plano: ${plano || "(vazio)"} | dataId: ${dataId}\nVerifique manualmente — cliente pode ter pago sem receber acesso.`);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("webhook/mercadopago error:", err);
    await alertarTelegram("🔴", "Falha no webhook do Mercado Pago", String(err)).catch(() => {});
    return NextResponse.json({ ok: true }); // sempre 200 para MP
  }
}
