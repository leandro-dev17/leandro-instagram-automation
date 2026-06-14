/**
 * AGENTE AUGUSTO ASSINATURAS
 * Webhook do Mercado Pago — processa pagamentos, renovações e cancelamentos.
 * Ativa/desativa acesso ao grupo WhatsApp automaticamente.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { MercadoPagoConfig, Payment, PreApproval } from "mercadopago";
import { enviarEmailBoasVindas, enviarEmailCancelamento, enviarEmailInadimplente } from "@/lib/brevo";
import { enviarMensagemPrivada, adicionarMembroGrupo, removerMembroGrupo, buildBoasVindas, getLinkGrupo } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import type { Plano } from "@/lib/db";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

// ─── ATIVAR ACESSO ─────────────────────────────────────────────────────────────

async function ativarAcesso(usuarioId: number, plano: Plano, mpSubscriptionId: string, valor: number, ciclo: "mensal" | "anual" = "mensal") {
  // Atualiza usuário
  await sql`
    UPDATE usuarios
    SET plano = ${plano}, status = 'ativo', mp_subscription_id = ${mpSubscriptionId},
        assinatura_inicio = NOW(), updated_at = NOW()
    WHERE id = ${usuarioId}
  `;

  // Registra assinatura com ciclo correto
  await sql`
    INSERT INTO assinaturas (usuario_id, plano, valor, ciclo, status, mp_subscription_id)
    VALUES (${usuarioId}, ${plano}, ${valor}, ${ciclo}, 'ativa', ${mpSubscriptionId})
    ON CONFLICT (mp_subscription_id) DO UPDATE SET status = 'ativa', renovada_em = NOW()
  `;

  // Busca dados do usuário
  const rows = await sql`SELECT nome, email, telefone FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
  if (rows.length === 0) return;
  const { nome, email, telefone } = rows[0];

  // Adiciona ao grupo WhatsApp
  if (telefone) {
    await adicionarMembroGrupo(telefone, plano);

    // Registra membro no grupo
    const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${plano} LIMIT 1`;
    if (grupoRows.length > 0) {
      await sql`
        INSERT INTO membros_grupos (usuario_id, grupo_id, status)
        VALUES (${usuarioId}, ${grupoRows[0].id}, 'ativo')
        ON CONFLICT (usuario_id, grupo_id) DO UPDATE SET status = 'ativo', data_saida = NULL
      `;
      await sql`UPDATE grupos_whatsapp SET membros_ativos = membros_ativos + 1 WHERE id = ${grupoRows[0].id}`;
    }

    // Mensagem de boas-vindas privada
    const msgBoasVindas = buildBoasVindas(plano, nome);
    await enviarMensagemPrivada(telefone, msgBoasVindas);
  }

  // E-mail de boas-vindas
  const linkGrupo = getLinkGrupo(plano);
  await enviarEmailBoasVindas(email, nome, plano, linkGrupo).catch(() => {});

  // Log
  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes)
    VALUES ('augusto-assinaturas', 'ativar_acesso', 'sucesso', ${JSON.stringify({ usuarioId, plano, mpSubscriptionId, dataId: mpSubscriptionId })})
  `;
}

// ─── RENOVAR ACESSO ────────────────────────────────────────────────────────────

async function renovarAcesso(mpSubscriptionId: string) {
  await sql`
    UPDATE assinaturas SET renovada_em = NOW() WHERE mp_subscription_id = ${mpSubscriptionId}
  `;
  await sql`
    UPDATE usuarios SET status = 'ativo', updated_at = NOW()
    WHERE mp_subscription_id = ${mpSubscriptionId} AND status = 'inadimplente'
  `;
}

// ─── DESATIVAR ACESSO ──────────────────────────────────────────────────────────

async function desativarAcesso(mpSubscriptionId: string, motivo: "cancelado" | "inadimplente") {
  const rows = await sql`
    SELECT u.id, u.nome, u.email, u.telefone, u.plano
    FROM usuarios u
    WHERE u.mp_subscription_id = ${mpSubscriptionId}
    LIMIT 1
  `;
  if (rows.length === 0) return;

  const { id, nome, email, telefone, plano } = rows[0];

  // Atualiza status
  await sql`
    UPDATE usuarios SET status = ${motivo}, updated_at = NOW() WHERE id = ${id}
  `;
  await sql`
    UPDATE assinaturas SET status = ${motivo} WHERE mp_subscription_id = ${mpSubscriptionId}
  `;

  // Remove do grupo WhatsApp
  if (telefone && plano) {
    await removerMembroGrupo(telefone, plano as Plano);
    const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${plano} LIMIT 1`;
    if (grupoRows.length > 0) {
      await sql`
        UPDATE membros_grupos SET status = 'removido', data_saida = NOW()
        WHERE usuario_id = ${id} AND grupo_id = ${grupoRows[0].id}
      `;
      await sql`UPDATE grupos_whatsapp SET membros_ativos = GREATEST(0, membros_ativos - 1) WHERE id = ${grupoRows[0].id}`;
    }
  }

  // E-mail
  if (motivo === "cancelado") {
    await enviarEmailCancelamento(email, nome).catch(() => {});
  } else {
    await enviarEmailInadimplente(email, nome).catch(() => {});
  }

  // Notifica General Alves (CEO) no Telegram
  await alertarTelegram(
    motivo === "cancelado" ? "🟡" : "🔴",
    `Acesso ${motivo}`,
    `Usuário: ${nome} (${email})\nPlano: ${plano}\nMotivo: ${motivo}`
  );

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes)
    VALUES ('augusto-assinaturas', 'desativar_acesso', 'sucesso', ${JSON.stringify({ id, plano, motivo })})
  `;
}

// ─── VALIDAÇÃO HMAC ────────────────────────────────────────────────────────────

async function validarWebhook(req: NextRequest, rawBody: string): Promise<boolean> {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!secret) {
    console.error("MERCADOPAGO_WEBHOOK_SECRET não configurada — rejeitando webhook");
    return false;
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature) return false;

  const ts = xSignature.match(/ts=([^,]+)/)?.[1];
  const v1 = xSignature.match(/v1=([^,]+)/)?.[1];
  if (!ts || !v1) return false;

  const dataId = new URL(req.url).searchParams.get("data.id") || "";
  const manifest = `id:${dataId};request-id:${xRequestId || ""};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const computed = Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");

  return computed === v1;
}

// ─── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();

    if (!(await validarWebhook(req, rawBody))) {
      return NextResponse.json({ ok: true }); // retorna 200 para MP não retentar
    }

    const body = JSON.parse(rawBody);
    const tipo = body.type as string;
    const dataId = body.data?.id as string | undefined;
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
      return NextResponse.json({ ok: true, motivo: "duplicata ignorada" });
    }

    if (tipo === "subscription_preapproval") {
      const preApprovalClient = new PreApproval(client);
      const pa = await preApprovalClient.get({ id: dataId });

      if (pa.status === "authorized") {
        // external_reference: "usuarioId|plano|ciclo"
        const partes = (pa.external_reference || "").split("|");
        const usuarioId = parseInt(partes[0]);
        const plano = (partes[1] || "vip") as Plano;
        const ciclo = (partes[2] || "mensal") as "mensal" | "anual";
        const valor = (pa.auto_recurring as { transaction_amount?: number })?.transaction_amount ?? 0;

        if (usuarioId && !isNaN(usuarioId) && ["vip","elite"].includes(plano)) {
          await ativarAcesso(usuarioId, plano, dataId, valor, ciclo);
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
        await renovarAcesso(preapprovalId);
      } else if (["rejected", "cancelled"].includes(payment.status || "") && preapprovalId) {
        await desativarAcesso(preapprovalId, "inadimplente");
      }

    } else if (tipo === "payment") {
      // Pagamento Pix anual (one-shot)
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });

      if (payment.status === "approved") {
        const meta = payment.metadata as { usuario_id?: number; plano?: string; ciclo?: string } | undefined;
        const usuarioId = meta?.usuario_id;
        const plano = (meta?.plano || "elite") as Plano;
        const ciclo = (meta?.ciclo === "anual" ? "anual" : "mensal") as "mensal" | "anual";

        if (usuarioId && ["vip", "elite"].includes(plano)) {
          await ativarAcesso(usuarioId, plano, String(dataId), payment.transaction_amount || 0, ciclo);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("webhook/mercadopago error:", err);
    return NextResponse.json({ ok: true }); // sempre 200 para MP
  }
}
