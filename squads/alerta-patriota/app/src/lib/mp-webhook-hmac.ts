/**
 * Validação HMAC do webhook do Mercado Pago — extraída de api/webhook/mercadopago/route.ts
 * (FASE 38) para ser testável sem precisar construir um NextRequest real. Comportamento
 * idêntico ao original: sem x-signature, aceita (MP ainda não configurou secret); com
 * x-signature mas sem secret configurada, rejeita; tenta 3 formatos de manifest porque o
 * MP varia o formato dependendo da versão da API (ver memory feedback_webhook_mp_signature).
 */
export async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function validarAssinaturaWebhook(params: {
  secret: string | undefined;
  xSignature: string | null;
  xRequestId: string | null;
  dataId: string;
}): Promise<boolean> {
  const { secret, xSignature, xRequestId, dataId } = params;

  if (!xSignature) return true;
  if (!secret) return false;

  const ts = xSignature.match(/ts=([^,]+)/)?.[1];
  const v1 = xSignature.match(/v1=([^,]+)/)?.[1];
  if (!ts || !v1) return false;

  const manifests = [
    `id:${dataId};request-id:${xRequestId || ""};ts:${ts};`, // formato completo
    `id:${dataId};request-id:;ts:${ts};`,                     // sem request-id
    `id:${dataId};ts:${ts};`,                                 // minimalista
  ];

  for (const manifest of manifests) {
    const computed = await hmacSha256(secret, manifest);
    if (computed === v1) return true;
  }

  return false;
}
