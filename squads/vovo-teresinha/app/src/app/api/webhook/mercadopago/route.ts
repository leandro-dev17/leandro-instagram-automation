import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { MercadoPagoConfig, Payment, PreApproval } from "mercadopago";
import { enviarEmailPremiumAtivado, enviarEmailCancelamento } from "@/lib/brevo";
import { enviarViaEvolution, buildMensagem } from "@/lib/whatsapp";

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

  const afiRows = await sql`SELECT id FROM afiliados WHERE codigo = ${codigoAfiliado} LIMIT 1`;
  if (afiRows.length === 0) return;

  const afiliadoId = afiRows[0].id;
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

async function enfileirarWhatsApp(usuarioId: number) {
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

  const mensagem = buildMensagem("boas_vindas_premium", u.nome, u.sexo as "M" | "F");
  const enviado = await enviarViaEvolution(u.whatsapp, mensagem);

  if (!enviado) {
    // Envio falhou — enfileira para o cron tentar novamente
    await sql`
      INSERT INTO whatsapp_fila (usuario_id, tipo, mensagem, agendado_para)
      VALUES (${usuarioId}, 'boas_vindas_premium', 'boas_vindas_premium', NOW())
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
  const plano = partes[1] || "trimestral";
  const codigoAfiliado = partes[2] || "";

  if (!usuarioId || isNaN(usuarioId)) return;

  const userRows = await sql`SELECT email, nome FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
  if (userRows.length === 0) return;

  await sql`
    UPDATE usuarios
    SET tipo_usuario = 'premium', plano = ${plano}, assinatura_id = ${preapprovalId}
    WHERE id = ${usuarioId}
  `;

  const valor = (preapproval.auto_recurring as { transaction_amount?: number } | undefined)?.transaction_amount ?? 0;

  await sql`
    INSERT INTO assinaturas (usuario_id, plano, status, mp_preapproval_id, valor)
    VALUES (${usuarioId}, ${plano}, 'ativo', ${preapprovalId}, ${valor})
    ON CONFLICT (mp_preapproval_id) DO UPDATE SET status = 'ativo', renovada_em = NOW()
  `;

  await enviarEmailPremiumAtivado(userRows[0].email, userRows[0].nome, plano).catch(() => {});
  await enfileirarWhatsApp(usuarioId);
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
  const plano = meta?.plano || "trimestral";
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
  await enfileirarWhatsApp(usuarioId);
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
    UPDATE assinaturas SET status = 'cancelado'
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
      UPDATE usuarios SET tipo_usuario = 'free', plano = null
      WHERE id = ${usuario_id} AND tipo_usuario = 'premium'
    `;
    await enviarEmailCancelamento(email, nome).catch(() => {});
  }
}

async function validarAssinaturaMP(req: NextRequest, rawBody: string): Promise<boolean> {
  const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  if (!webhookSecret) {
    // Em produção, rejeitar sem HMAC configurado — risco de fraude
    if (process.env.NODE_ENV === "production") {
      console.error(
        "[webhook/mercadopago] 🚨 MERCADOPAGO_WEBHOOK_SECRET não configurado em produção. " +
        "Requisição BLOQUEADA por segurança. Configure a variável no Vercel Dashboard."
      );
      return false;
    }
    // Fora de produção aceita sem HMAC (modo dev/preview)
    return true;
  }

  const xSignature = req.headers.get("x-signature");
  const xRequestId = req.headers.get("x-request-id");
  if (!xSignature) return false;

  const ts = xSignature.match(/ts=([^,]+)/)?.[1];
  const v1 = xSignature.match(/v1=([^,]+)/)?.[1];
  if (!ts || !v1) return false;

  const url = new URL(req.url);
  const dataId = url.searchParams.get("data.id") || "";
  const manifest = `id:${dataId};request-id:${xRequestId || ""};ts:${ts};`;

  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(webhookSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signatureBuffer = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(manifest));
  const computed = Array.from(new Uint8Array(signatureBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");

  return computed === v1;
}

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    const valid = await validarAssinaturaMP(req, rawBody);
    if (!valid) {
      console.warn("webhook/mercadopago: assinatura inválida");
      return NextResponse.json({ ok: true }); // retorna 200 para o MP não retentar
    }

    const body = JSON.parse(rawBody);
    const tipo = body.type as string;
    const dataId = body.data?.id as string | undefined;

    if (!dataId) return NextResponse.json({ ok: true });

    if (tipo === "subscription_preapproval") {
      const preApprovalClient = new PreApproval(client);
      const preapproval = await preApprovalClient.get({ id: dataId });

      if (preapproval.status === "authorized") {
        await processarAssinaturaAutorizada(dataId);
      } else if (["cancelled", "paused"].includes(preapproval.status || "")) {
        await processarCancelamento(dataId);
      }
    } else if (tipo === "subscription_authorized_payment") {
      // Evento de cobrança recorrente processada — busca o preapproval_id via API de payment
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });
      const preapprovalId = (payment as unknown as Record<string, unknown>).preapproval_id as string | undefined;

      if (payment.status === "approved" && preapprovalId) {
        await processarRenovacao(preapprovalId);
      } else if (["rejected", "cancelled"].includes(payment.status || "") && preapprovalId) {
        // Pagamento falhou — cancelar assinatura
        await processarCancelamento(preapprovalId);
      }
    } else if (tipo === "payment") {
      // Pagamento pontual (legado ou pagamento manual)
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });

      if (payment.status === "approved") {
        await processarPagamentoAprovado(dataId);
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("webhook/mercadopago error", err);
    return NextResponse.json({ ok: true });
  }
}
