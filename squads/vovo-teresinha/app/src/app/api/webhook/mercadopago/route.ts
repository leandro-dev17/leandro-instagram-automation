import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { MercadoPagoConfig, Payment, PreApproval } from "mercadopago";
import { enviarEmailPremiumAtivado, enviarEmailCancelamento } from "@/lib/brevo";
import { enviarViaEvolution, buildMensagem } from "@/lib/whatsapp";
import { PLANOS, PlanoId } from "@/lib/planos";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

const COMISSAO_TIERS = [
  { min: 10, valor: 30 },
  { min: 5, valor: 25 },
  { min: 1, valor: 20 },
];

function calcularComissao(conversoes: number): number {
  for (const tier of COMISSAO_TIERS) {
    if (conversoes >= tier.min) return tier.valor;
  }
  return 20;
}

async function registrarComissaoAfiliado(usuarioId: number, codigoAfiliado: string, plano: string) {
  if (!codigoAfiliado) return;
  if (plano === "caderninho") return;

  const afiRows = await sql`SELECT id FROM afiliados WHERE codigo = ${codigoAfiliado} LIMIT 1`;
  if (afiRows.length === 0) return;

  const afiliadoId = afiRows[0].id;

  // Evita comissão duplicada em caso de reentrega do webhook pelo MP (at-least-once delivery)
  const jaExiste = await sql`
    SELECT id FROM comissoes WHERE afiliado_id = ${afiliadoId} AND usuario_id = ${usuarioId} LIMIT 1
  `;
  if (jaExiste.length > 0) return;

  const convRows = await sql`
    SELECT COUNT(*) as total FROM comissoes WHERE afiliado_id = ${afiliadoId} AND status != 'rejeitado'
  `;
  const total = parseInt(convRows[0].total) + 1;
  const valorComissao = calcularComissao(total);

  const liberadoEm = new Date();
  liberadoEm.setDate(liberadoEm.getDate() + 30);

  await sql`
    INSERT INTO comissoes (afiliado_id, usuario_id, valor, status, liberado_em)
    VALUES (${afiliadoId}, ${usuarioId}, ${valorComissao}, 'pendente', ${liberadoEm.toISOString()})
    ON CONFLICT DO NOTHING
  `;

  const tierNovo = total < 5 ? 1 : total < 10 ? 2 : 3;
  await sql`UPDATE afiliados SET tier = ${tierNovo} WHERE id = ${afiliadoId}`;
}

async function enfileirarWhatsApp(usuarioId: number, plano: string) {
  if (!process.env.EVOLUTION_API_URL || !process.env.EVOLUTION_API_KEY) return;

  const uRows = await sql`
    SELECT u.whatsapp, u.aceita_whatsapp, u.nome,
           COALESCE(al.sexo, 'F') as sexo
    FROM usuarios u
    LEFT JOIN alunas_leandro al ON al.email = u.email
    WHERE u.id = ${usuarioId} LIMIT 1
  `;
  const u = uRows[0];
  if (!u?.whatsapp || !u?.aceita_whatsapp) return;

  const tipoMsg = plano === "livro_receitas" ? "boas_vindas_livro" : "boas_vindas_caderninho";
  const mensagem = buildMensagem(tipoMsg, u.nome, u.sexo as "M" | "F");
  const enviado = await enviarViaEvolution(u.whatsapp, mensagem);

  if (!enviado) {
    // Envio falhou — enfileira para o cron tentar novamente
    await sql`
      INSERT INTO whatsapp_fila (usuario_id, tipo, mensagem, agendado_para)
      VALUES (${usuarioId}, ${tipoMsg}, ${tipoMsg}, NOW())
      ON CONFLICT DO NOTHING
    `.catch(() => {});
  }
}

// Ativação quando assinatura recorrente é autorizada pelo pagador
async function processarAssinaturaAutorizada(preapprovalId: string) {
  const preApprovalClient = new PreApproval(client);
  const preapproval = await preApprovalClient.get({ id: preapprovalId });

  if (preapproval.status !== "authorized") return;

  // external_reference: "userId|plano|codigoAfiliado"
  const partes = (preapproval.external_reference || "").split("|");
  const usuarioId = parseInt(partes[0]);
  const plano = partes[1] || "caderninho";
  const codigoAfiliado = partes[2] || "";

  if (!usuarioId || isNaN(usuarioId)) return;

  const userRows = await sql`SELECT email, nome FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
  if (userRows.length === 0) return;

  const freeTrialDias = PLANOS[plano as PlanoId]?.freeTrialDias ?? 0;
  const trialFim = freeTrialDias > 0 ? new Date(Date.now() + freeTrialDias * 86400000).toISOString() : null;

  await sql`
    UPDATE usuarios
    SET tipo_usuario = 'premium', plano = ${plano}, assinatura_id = ${preapprovalId}, trial_fim = ${trialFim}
    WHERE id = ${usuarioId}
  `;

  const valor = (preapproval.auto_recurring as { transaction_amount?: number } | undefined)?.transaction_amount ?? 0;

  await sql`
    INSERT INTO assinaturas (usuario_id, plano, status, mp_preapproval_id, valor, renovada_em)
    VALUES (${usuarioId}, ${plano}, 'ativo', ${preapprovalId}, ${valor}, NOW())
    ON CONFLICT (mp_preapproval_id) DO UPDATE SET status = 'ativo', renovada_em = NOW()
  `;

  await enviarEmailPremiumAtivado(userRows[0].email, userRows[0].nome, plano).catch(() => {});
  await enfileirarWhatsApp(usuarioId, plano);
  await registrarComissaoAfiliado(usuarioId, codigoAfiliado, plano);
}

// Renovação mensal/anual bem-sucedida
async function processarRenovacao(preapprovalId: string) {
  const rows = await sql`
    SELECT a.usuario_id FROM assinaturas a
    WHERE a.mp_preapproval_id = ${preapprovalId} AND a.status = 'ativo'
    LIMIT 1
  `;
  if (rows.length === 0) return;

  await sql`
    UPDATE assinaturas SET renovada_em = NOW()
    WHERE mp_preapproval_id = ${preapprovalId}
  `;

  // Garante que o usuário ainda está marcado como premium
  await sql`
    UPDATE usuarios SET tipo_usuario = 'premium'
    WHERE id = ${rows[0].usuario_id} AND tipo_usuario != 'aluna_leandro' AND tipo_usuario != 'admin'
  `;
}

// Pagamento pontual aprovado (caso de migração ou fallback de pagamento único)
async function processarPagamentoAprovado(paymentId: string) {
  const paymentClient = new Payment(client);
  const payment = await paymentClient.get({ id: paymentId });

  if (payment.status !== "approved") return;

  const meta = payment.metadata as {
    usuario_id?: number;
    plano?: string;
    codigo_afiliado?: string;
  };

  const usuarioId = meta?.usuario_id;
  const plano = meta?.plano || "caderninho";
  const codigoAfiliado = meta?.codigo_afiliado || "";

  if (!usuarioId) return;

  const userRows = await sql`SELECT email, nome FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
  if (userRows.length === 0) return;

  await sql`
    UPDATE usuarios
    SET tipo_usuario = 'premium', plano = ${plano}, assinatura_id = ${String(paymentId)}
    WHERE id = ${usuarioId}
  `;

  await sql`
    INSERT INTO assinaturas (usuario_id, plano, status, mp_payment_id, valor)
    VALUES (${usuarioId}, ${plano}, 'ativo', ${String(paymentId)}, ${payment.transaction_amount || 0})
    ON CONFLICT (mp_payment_id) DO NOTHING
  `;

  await enviarEmailPremiumAtivado(userRows[0].email, userRows[0].nome, plano).catch(() => {});
  await enfileirarWhatsApp(usuarioId, plano);
  await registrarComissaoAfiliado(usuarioId, codigoAfiliado, plano);
}

// Cancelamento de assinatura recorrente
async function processarCancelamento(preapprovalId: string) {
  const preApprovalClient = new PreApproval(client);
  const preapproval = await preApprovalClient.get({ id: preapprovalId });

  if (!["cancelled", "paused"].includes(preapproval.status || "")) return;

  const rows = await sql`
    SELECT a.usuario_id, u.email, u.nome
    FROM assinaturas a
    JOIN usuarios u ON u.id = a.usuario_id
    WHERE a.mp_preapproval_id = ${preapprovalId}
    LIMIT 1
  `;

  if (rows.length === 0) return;

  const { usuario_id, email, nome } = rows[0];

  await sql`
    UPDATE assinaturas SET status = 'cancelado', cancelado_em = NOW()
    WHERE mp_preapproval_id = ${preapprovalId}
  `;

  // Só rebaixa se não houver outra assinatura ativa
  const outraAtiva = await sql`
    SELECT id FROM assinaturas
    WHERE usuario_id = ${usuario_id} AND status = 'ativo' AND mp_preapproval_id != ${preapprovalId}
    LIMIT 1
  `;

  if (outraAtiva.length === 0) {
    await sql`
      UPDATE usuarios SET tipo_usuario = 'free', plano = null, trial_fim = NULL
      WHERE id = ${usuario_id} AND tipo_usuario = 'premium'
    `;
    await enviarEmailCancelamento(email, nome).catch(() => {});
  }
}

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validarAssinaturaMP(req: NextRequest, rawBody: string): Promise<boolean> {
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const xSignature = req.headers.get("x-signature");

  if (!webhookSecret) {
    console.error(
      "[webhook/mercadopago] 🚨 MERCADOPAGO_WEBHOOK_SECRET ausente. " +
      "Aceito temporariamente, mas configure no Vercel e no painel MP para ativar HMAC."
    );
    return true;
  }

  if (!xSignature) {
    // MP ainda não está enviando x-signature neste evento — aceita sem validação HMAC
    console.log("[webhook/mercadopago] Sem x-signature — aceitando sem validação HMAC");
    return true;
  }

  const xRequestId = req.headers.get("x-request-id") || "";
  const ts = xSignature.match(/ts=([^,]+)/)?.[1];
  const v1 = xSignature.match(/v1=([^,]+)/)?.[1];

  if (!ts || !v1) {
    console.error("[webhook/mercadopago] x-signature malformado:", xSignature);
    return false;
  }

  const dataId = new URL(req.url).searchParams.get("data.id") || "";

  // Tenta manifests alternativos (MP varia o formato dependendo da versão)
  const manifests = [
    `id:${dataId};request-id:${xRequestId};ts:${ts};`,
    `id:${dataId};request-id:;ts:${ts};`,
    `id:${dataId};ts:${ts};`,
  ];

  for (const manifest of manifests) {
    const computed = await hmacSha256(webhookSecret, manifest);
    if (computed === v1) {
      console.log("[webhook/mercadopago] HMAC válido ✓ manifest:", manifest);
      return true;
    }
  }

  console.error(
    "[webhook/mercadopago] HMAC inválido. v1 esperado:", v1,
    "| dataId:", dataId, "| ts:", ts, "| x-request-id:", xRequestId
  );
  return false;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    console.log(
      "[webhook/mercadopago] Recebido — url:", req.url,
      "| x-signature:", req.headers.get("x-signature")?.substring(0, 40) || "AUSENTE"
    );

    const valid = await validarAssinaturaMP(req, rawBody);
    if (!valid) {
      console.error("[webhook/mercadopago] Validação falhou — descartando evento");
      return NextResponse.json({ ok: true }); // retorna 200 para o MP não retentar
    }

    const body = JSON.parse(rawBody);
    const tipo = body.type as string;
    const dataId = body.data?.id as string | undefined;
    console.log("[webhook/mercadopago] tipo:", tipo, "| dataId:", dataId);

    if (!dataId) return NextResponse.json({ ok: true });

    if (tipo === "subscription_preapproval") {
      const preApprovalClient = new PreApproval(client);
      const preapproval = await preApprovalClient.get({ id: dataId });
      console.log("[webhook/mercadopago] preapproval status:", preapproval.status, "| external_reference:", preapproval.external_reference);

      if (preapproval.status === "authorized") {
        await processarAssinaturaAutorizada(dataId);
        console.log("[webhook/mercadopago] processarAssinaturaAutorizada concluído — dataId:", dataId);
      } else if (["cancelled", "paused"].includes(preapproval.status || "")) {
        await processarCancelamento(dataId);
        console.log("[webhook/mercadopago] processarCancelamento concluído — dataId:", dataId);
      }
    } else if (tipo === "subscription_authorized_payment") {
      // Evento de cobrança recorrente processada — busca o preapproval_id via API de payment
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });
      const preapprovalId = (payment as unknown as Record<string, unknown>).preapproval_id as string | undefined;
      console.log("[webhook/mercadopago] subscription_authorized_payment status:", payment.status, "| preapprovalId:", preapprovalId);

      if (payment.status === "approved" && preapprovalId) {
        await processarRenovacao(preapprovalId);
        console.log("[webhook/mercadopago] processarRenovacao concluído — preapprovalId:", preapprovalId);
      } else if (["rejected", "cancelled"].includes(payment.status || "") && preapprovalId) {
        // Pagamento falhou — cancelar assinatura
        await processarCancelamento(preapprovalId);
        console.log("[webhook/mercadopago] processarCancelamento (falha de pagamento) concluído — preapprovalId:", preapprovalId);
      }
    } else if (tipo === "payment") {
      // Pagamento pontual (legado ou pagamento manual)
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });
      console.log("[webhook/mercadopago] payment status:", payment.status);

      if (payment.status === "approved") {
        await processarPagamentoAprovado(dataId);
        console.log("[webhook/mercadopago] processarPagamentoAprovado concluído — dataId:", dataId);
      }
    } else {
      console.log("[webhook/mercadopago] tipo de evento não tratado:", tipo);
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[webhook/mercadopago] error", err);
    return NextResponse.json({ ok: true });
  }
}
