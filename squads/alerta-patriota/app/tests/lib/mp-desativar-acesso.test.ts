import { describe, it, expect, vi, beforeEach } from "vitest";

const sqlMock = vi.fn();
const transactionMock = vi.fn();
const sql = (...args: unknown[]) => sqlMock(...args);
sql.transaction = (...args: unknown[]) => transactionMock(...args);
vi.mock("@/lib/db", () => ({ sql }));

const enviarEmailCancelamentoMock = vi.fn();
const enviarEmailInadimplenteMock = vi.fn();
vi.mock("@/lib/brevo", () => ({
  enviarEmailCancelamento: (...args: unknown[]) => enviarEmailCancelamentoMock(...args),
  enviarEmailInadimplente: (...args: unknown[]) => enviarEmailInadimplenteMock(...args),
}));

const removerMembroGrupoMock = vi.fn();
vi.mock("@/lib/whatsapp", () => ({ removerMembroGrupo: (...args: unknown[]) => removerMembroGrupoMock(...args) }));

const alertarTelegramMock = vi.fn();
vi.mock("@/lib/telegram", () => ({ alertarTelegram: (...args: unknown[]) => alertarTelegramMock(...args) }));

const { desativarAcesso, renovarAcesso } = await import("@/lib/mp-desativar-acesso");

function mockSqlPorTexto(respostas: Record<string, unknown>) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const texto = strings.join(" ");
    for (const [chave, valor] of Object.entries(respostas)) {
      if (texto.includes(chave)) return Promise.resolve(valor);
    }
    return Promise.resolve(undefined);
  });
}

describe("desativarAcesso", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    transactionMock.mockReset();
    enviarEmailCancelamentoMock.mockReset();
    enviarEmailInadimplenteMock.mockReset();
    removerMembroGrupoMock.mockReset();
    alertarTelegramMock.mockReset();

    transactionMock.mockResolvedValue(undefined);
    enviarEmailCancelamentoMock.mockResolvedValue(true);
    enviarEmailInadimplenteMock.mockResolvedValue(true);
  });

  it("usuário não encontrado: retorna cedo sem efeitos colaterais", async () => {
    mockSqlPorTexto({ "SELECT u.id": [] });

    await desativarAcesso("sub_x", "cancelado");

    expect(transactionMock).not.toHaveBeenCalled();
    expect(removerMembroGrupoMock).not.toHaveBeenCalled();
    expect(enviarEmailCancelamentoMock).not.toHaveBeenCalled();
    expect(alertarTelegramMock).not.toHaveBeenCalled();
  });

  it("cancelamento bem-sucedido: remove do grupo, manda e-mail de cancelamento, alerta amarelo", async () => {
    mockSqlPorTexto({
      "SELECT u.id": [{ id: 1, nome: "Maria", email: "maria@x.com", telefone: "5511999999999", plano: "vip" }],
      "SELECT id FROM grupos_whatsapp": [{ id: 7 }],
    });
    removerMembroGrupoMock.mockResolvedValue(true);

    await desativarAcesso("sub_1", "cancelado");

    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(removerMembroGrupoMock).toHaveBeenCalledWith("5511999999999", "vip");
    expect(enviarEmailCancelamentoMock).toHaveBeenCalledWith("maria@x.com", "Maria");
    expect(enviarEmailInadimplenteMock).not.toHaveBeenCalled();
    expect(alertarTelegramMock).toHaveBeenCalledWith("🟡", "Acesso cancelado", expect.any(String));
    expect(
      sqlMock.mock.calls.some((c) => (c[0] as TemplateStringsArray).join(" ").includes("status = 'removido'"))
    ).toBe(true);
  });

  it("remoção do grupo falha: loga erro em vez de marcar 'removido'", async () => {
    mockSqlPorTexto({
      "SELECT u.id": [{ id: 2, nome: "João", email: "joao@x.com", telefone: "5511988888888", plano: "elite" }],
      "SELECT id FROM grupos_whatsapp": [{ id: 9 }],
    });
    removerMembroGrupoMock.mockResolvedValue(false);

    await desativarAcesso("sub_2", "inadimplente");

    expect(
      sqlMock.mock.calls.some((c) => (c[0] as TemplateStringsArray).join(" ").includes("status = 'removido'"))
    ).toBe(false);
    expect(
      sqlMock.mock.calls.some(
        (c) =>
          (c[0] as TemplateStringsArray).join(" ").includes("remover_grupo") &&
          (c[0] as TemplateStringsArray).join(" ").includes("'erro'")
      )
    ).toBe(true);
    expect(enviarEmailInadimplenteMock).toHaveBeenCalledWith("joao@x.com", "João");
    expect(enviarEmailCancelamentoMock).not.toHaveBeenCalled();
    expect(alertarTelegramMock).toHaveBeenCalledWith("🔴", "Acesso inadimplente", expect.any(String));
  });
});

describe("renovarAcesso", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    transactionMock.mockReset();
    transactionMock.mockResolvedValue(undefined);
    sqlMock.mockImplementation((strings: TemplateStringsArray) => strings.join(""));
  });

  it("monta as 3 escritas (renovação, reativação e pagamento) em um único lote atômico", async () => {
    await renovarAcesso("sub_1", "pay_1", 29.9);

    expect(transactionMock).toHaveBeenCalledTimes(1);
    const queries = transactionMock.mock.calls[0][0] as string[];
    expect(queries).toHaveLength(3);
    // FASE 41: renovarAcesso deve restaurar status='ativa' além de atualizar renovada_em
    expect(queries[0]).toContain("UPDATE assinaturas SET status = 'ativa'");
    expect(queries[0]).toContain("renovada_em");
    expect(queries[1]).toContain("UPDATE usuarios SET status = 'ativo'");
    expect(queries[2]).toContain("INSERT INTO pagamentos");
  });
});
