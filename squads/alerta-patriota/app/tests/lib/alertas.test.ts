import { describe, it, expect, vi, beforeEach } from "vitest";

// Fase 17: antes deste helper, ~20 rotas fiscal-* inseriam um alerta novo a cada execução
// enquanto a condição persistisse, gerando spam idêntico no Telegram. Este teste trava o
// comportamento de dedup: não insere se já existe um alerta do mesmo tipo não resolvido
// dentro da janela.

const sqlMock = vi.fn();
vi.mock("@/lib/db", () => ({ sql: (...args: unknown[]) => sqlMock(...args) }));

const { criarAlertaDedup } = await import("@/lib/alertas");

describe("criarAlertaDedup", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("cria o alerta se não há nenhum não-resolvido na janela", async () => {
    sqlMock.mockResolvedValueOnce([]); // SELECT existente: nada encontrado
    sqlMock.mockResolvedValueOnce([]); // INSERT

    const r = await criarAlertaDedup("fiscal-mrr", "alto", "MRR caiu 20%");

    expect(r).toEqual({ criado: true });
    expect(sqlMock).toHaveBeenCalledTimes(2); // SELECT + INSERT
  });

  it("NÃO cria o alerta (evita spam) se já existe um não-resolvido na janela", async () => {
    sqlMock.mockResolvedValueOnce([{ id: 99 }]); // SELECT existente: já tem um

    const r = await criarAlertaDedup("fiscal-trials", "medio", "3 trials expirando");

    expect(r).toEqual({ criado: false });
    expect(sqlMock).toHaveBeenCalledTimes(1); // só o SELECT, sem INSERT
  });
});
