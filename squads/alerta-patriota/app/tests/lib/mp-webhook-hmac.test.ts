import { describe, it, expect } from "vitest";
import { createHmac } from "node:crypto";
import { validarAssinaturaWebhook } from "@/lib/mp-webhook-hmac";

// Calcula o HMAC de forma independente da implementação testada (usando o módulo
// nativo node:crypto em vez do Web Crypto usado em lib/mp-webhook-hmac.ts), para
// que o teste não valide a função contra ela mesma.
function v1Esperado(secret: string, manifest: string): string {
  return createHmac("sha256", secret).update(manifest).digest("hex");
}

describe("validarAssinaturaWebhook", () => {
  it("sem x-signature: aceita (MP ainda não configurou secret)", async () => {
    const r = await validarAssinaturaWebhook({ secret: undefined, xSignature: null, xRequestId: null, dataId: "123" });
    expect(r).toBe(true);
  });

  it("x-signature presente mas sem secret configurada: rejeita", async () => {
    const r = await validarAssinaturaWebhook({
      secret: undefined,
      xSignature: "ts=1700000000,v1=abcdef",
      xRequestId: "req-1",
      dataId: "123",
    });
    expect(r).toBe(false);
  });

  it("x-signature malformado (sem ts ou v1): rejeita", async () => {
    const r = await validarAssinaturaWebhook({
      secret: "segredo",
      xSignature: "formato-invalido",
      xRequestId: "req-1",
      dataId: "123",
    });
    expect(r).toBe(false);
  });

  it("assinatura válida no formato completo (com request-id): aceita", async () => {
    const secret = "segredo-123";
    const dataId = "456";
    const ts = "1700000000";
    const xRequestId = "req-abc";
    const manifest = `id:${dataId};request-id:${xRequestId};ts:${ts};`;
    const v1 = v1Esperado(secret, manifest);

    const r = await validarAssinaturaWebhook({ secret, xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId });
    expect(r).toBe(true);
  });

  it("assinatura válida sem x-request-id: aceita (cai no formato sem request-id)", async () => {
    const secret = "segredo-123";
    const dataId = "456";
    const ts = "1700000000";
    const manifest = `id:${dataId};request-id:;ts:${ts};`;
    const v1 = v1Esperado(secret, manifest);

    const r = await validarAssinaturaWebhook({ secret, xSignature: `ts=${ts},v1=${v1}`, xRequestId: null, dataId });
    expect(r).toBe(true);
  });

  it("assinatura só bate com o formato minimalista: tenta os 3 formatos e aceita no terceiro", async () => {
    const secret = "segredo-123";
    const dataId = "456";
    const ts = "1700000000";
    const xRequestId = "req-abc"; // presente, mas o v1 foi calculado SEM ele — só bate no formato minimalista
    const manifestMinimalista = `id:${dataId};ts:${ts};`;
    const v1 = v1Esperado(secret, manifestMinimalista);

    const r = await validarAssinaturaWebhook({ secret, xSignature: `ts=${ts},v1=${v1}`, xRequestId, dataId });
    expect(r).toBe(true);
  });

  it("assinatura que não bate em nenhum dos 3 formatos: rejeita", async () => {
    const r = await validarAssinaturaWebhook({
      secret: "segredo-123",
      xSignature: "ts=1700000000,v1=00112233445566778899aabbccddeeff00112233445566778899aabbccddee",
      xRequestId: "req-abc",
      dataId: "456",
    });
    expect(r).toBe(false);
  });
});
