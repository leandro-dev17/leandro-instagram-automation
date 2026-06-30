import { describe, it, expect, vi, beforeEach } from "vitest";

const sqlMock = vi.fn();
vi.mock("@/lib/db", () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

const { calcularMRR } = await import("@/lib/mrr");

describe("calcularMRR — agregação JS sobre as linhas do SQL", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("agrega porPlano, mrrTotal e totalAssinantes a partir das linhas retornadas", async () => {
    sqlMock.mockResolvedValueOnce([
      { plano: "vip", total: 10, soma: 297.0 },
      { plano: "elite", total: 5, soma: 248.5 },
    ]);

    const r = await calcularMRR();

    expect(r.porPlano).toEqual({
      vip: { assinantes: 10, mrr: 297.0 },
      elite: { assinantes: 5, mrr: 248.5 },
    });
    expect(r.mrrTotal).toBeCloseTo(545.5);
    expect(r.totalAssinantes).toBe(15);
  });

  it("retorna zeros quando não há assinaturas ativas", async () => {
    sqlMock.mockResolvedValueOnce([]);

    const r = await calcularMRR();

    expect(r.porPlano).toEqual({});
    expect(r.mrrTotal).toBe(0);
    expect(r.totalAssinantes).toBe(0);
  });

  it("a normalização anual→mensal (valor/12) já vem pronta do SQL — JS só soma o que recebe", async () => {
    // simula uma linha que já reflete o resultado da normalização feita em SQL
    // (12 assinaturas anuais de 600/ano = 50/mês cada = soma 600 no agregado)
    sqlMock.mockResolvedValueOnce([{ plano: "elite", total: 12, soma: 600 }]);

    const r = await calcularMRR();

    expect(r.porPlano.elite).toEqual({ assinantes: 12, mrr: 600 });
    expect(r.mrrTotal).toBe(600);
  });
});
