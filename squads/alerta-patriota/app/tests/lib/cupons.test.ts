import { describe, it, expect, vi, beforeEach } from "vitest";

const sqlMock = vi.fn();
vi.mock("@/lib/db", () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

const { validarCupom } = await import("@/lib/cupons");

describe("validarCupom", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("retorna sem desconto se não há cupom", async () => {
    const r = await validarCupom(undefined, "elite", 1);
    expect(r).toEqual({ desconto: 0, codigo: null });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("retorna sem desconto se o plano não é elite (cupons são só-Elite)", async () => {
    const r = await validarCupom("VOLTA10", "vip", 1);
    expect(r).toEqual({ desconto: 0, codigo: null });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("retorna sem desconto se o código não existe", async () => {
    const r = await validarCupom("NAOEXISTE", "elite", 1);
    expect(r).toEqual({ desconto: 0, codigo: null });
  });

  it("aceita o código em minúsculas (normaliza pra upper)", async () => {
    sqlMock.mockResolvedValueOnce([{ "?column?": 1 }]); // recebeuOnda
    sqlMock.mockResolvedValueOnce([{ id: 1 }]); // claim
    const r = await validarCupom("volta10", "elite", 1);
    expect(r).toEqual({ desconto: 0.10, codigo: "VOLTA10" });
  });

  it("retorna sem desconto se o usuário nunca recebeu a onda de engajamento correspondente", async () => {
    sqlMock.mockResolvedValueOnce([]); // recebeuOnda vazio
    const r = await validarCupom("VOLTA15", "elite", 42);
    expect(r).toEqual({ desconto: 0, codigo: null });
  });

  it("retorna sem desconto se o claim atômico falhar (cupom já usado — corrida de duplo clique)", async () => {
    sqlMock.mockResolvedValueOnce([{ "?column?": 1 }]); // recebeuOnda ok
    sqlMock.mockResolvedValueOnce([]); // claim vazio: cupom_usado já não era NULL
    const r = await validarCupom("VOLTA20", "elite", 7);
    expect(r).toEqual({ desconto: 0, codigo: null });
  });
});
