import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@/lib/db", () => ({ sql: vi.fn() }));
vi.mock("next/headers", () => ({ cookies: vi.fn() }));

process.env.JWT_SECRET = "test-jwt-secret-para-os-testes";
process.env.CRON_SECRET = "test-cron-secret";

const { gerarToken, verificarToken, verificarCronSecret, verificarSegredoAutofix } = await import("@/lib/auth");

function reqComAuth(valor: string | null): Request {
  const headers = new Headers();
  if (valor !== null) headers.set("authorization", valor);
  return new Request("https://x.test", { headers });
}

describe("token JWT (gerarToken/verificarToken)", () => {
  it("token gerado é válido e devolve o payload original", () => {
    const token = gerarToken({ id: 1, email: "a@b.com", tipo: "admin" });
    const payload = verificarToken(token);
    expect(payload).toMatchObject({ id: 1, email: "a@b.com", tipo: "admin" });
  });

  it("token inválido/adulterado retorna null em vez de lançar exceção", () => {
    expect(verificarToken("token.invalido.aqui")).toBeNull();
  });
});

describe("verificarCronSecret — comparação em tempo constante", () => {
  it("aceita o secret correto no formato 'Bearer <secret>'", () => {
    expect(verificarCronSecret(reqComAuth("Bearer test-cron-secret"))).toBe(true);
  });

  it("rejeita secret incorreto", () => {
    expect(verificarCronSecret(reqComAuth("Bearer secret-errado"))).toBe(false);
  });

  it("rejeita header ausente", () => {
    expect(verificarCronSecret(reqComAuth(null))).toBe(false);
  });

  it("rejeita secret de tamanho diferente sem lançar exceção (timingSafeEqual exige mesmo length)", () => {
    expect(verificarCronSecret(reqComAuth("Bearer curto"))).toBe(false);
  });
});

describe("verificarSegredoAutofix — secret dedicado do claude-resolver/claude-revisor", () => {
  beforeEach(() => {
    delete process.env.CLAUDE_AUTOFIX_SECRET;
  });

  it("usa CLAUDE_AUTOFIX_SECRET quando configurado (não aceita mais o CRON_SECRET)", () => {
    process.env.CLAUDE_AUTOFIX_SECRET = "secret-dedicado";
    expect(verificarSegredoAutofix(reqComAuth("Bearer secret-dedicado"))).toBe(true);
    expect(verificarSegredoAutofix(reqComAuth("Bearer test-cron-secret"))).toBe(false);
  });

  it("faz fallback pro CRON_SECRET quando CLAUDE_AUTOFIX_SECRET não está configurado", () => {
    expect(verificarSegredoAutofix(reqComAuth("Bearer test-cron-secret"))).toBe(true);
  });
});
