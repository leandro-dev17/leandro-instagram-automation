import { describe, it, expect, vi, beforeEach } from "vitest";

const sqlMock = vi.fn();
const transactionMock = vi.fn();
const sql = (...args: unknown[]) => sqlMock(...args);
sql.transaction = (...args: unknown[]) => transactionMock(...args);
vi.mock("@/lib/db", () => ({ sql }));

const enviarEmailBoasVindasMock = vi.fn();
vi.mock("@/lib/brevo", () => ({ enviarEmailBoasVindas: (...args: unknown[]) => enviarEmailBoasVindasMock(...args) }));

const enviarMensagemPrivadaMock = vi.fn();
const adicionarMembroGrupoMock = vi.fn();
const buildBoasVindasMock = vi.fn();
const getLinkGrupoMock = vi.fn();
vi.mock("@/lib/whatsapp", () => ({
  enviarMensagemPrivada: (...args: unknown[]) => enviarMensagemPrivadaMock(...args),
  adicionarMembroGrupo: (...args: unknown[]) => adicionarMembroGrupoMock(...args),
  buildBoasVindas: (...args: unknown[]) => buildBoasVindasMock(...args),
  getLinkGrupo: (...args: unknown[]) => getLinkGrupoMock(...args),
}));

const alertarTelegramMock = vi.fn();
vi.mock("@/lib/telegram", () => ({ alertarTelegram: (...args: unknown[]) => alertarTelegramMock(...args) }));

const { ativarAcesso } = await import("@/lib/mp-ativar-acesso");

// Resolve qualquer chamada sql`...` cujo texto bata com um dos textos-chave abaixo;
// chamadas que só montam queries do lote da transação não importam (transactionMock
// é mockado separadamente e nunca executa de fato o array recebido).
function mockSqlPorTexto(respostas: Record<string, unknown>) {
  sqlMock.mockImplementation((strings: TemplateStringsArray) => {
    const texto = strings.join(" ");
    for (const [chave, valor] of Object.entries(respostas)) {
      if (texto.includes(chave)) return Promise.resolve(valor);
    }
    return Promise.resolve(undefined);
  });
}

describe("ativarAcesso", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    transactionMock.mockReset();
    enviarEmailBoasVindasMock.mockReset();
    enviarMensagemPrivadaMock.mockReset();
    adicionarMembroGrupoMock.mockReset();
    buildBoasVindasMock.mockReset();
    getLinkGrupoMock.mockReset();
    alertarTelegramMock.mockReset();

    sqlMock.mockImplementation(() => Promise.resolve(undefined));
    transactionMock.mockResolvedValue(undefined);
    buildBoasVindasMock.mockReturnValue("mensagem de boas-vindas");
    getLinkGrupoMock.mockReturnValue("https://chat.whatsapp.com/grupo-vip");
    enviarEmailBoasVindasMock.mockResolvedValue(true);
  });

  it("caminho feliz: ativa, adiciona ao grupo, manda mensagem e e-mail", async () => {
    mockSqlPorTexto({
      "SELECT nome, email, telefone": [{ nome: "Maria", email: "maria@x.com", telefone: "5511999999999" }],
      "SELECT id FROM grupos_whatsapp": [{ id: 7 }],
    });
    adicionarMembroGrupoMock.mockResolvedValue(true);
    enviarMensagemPrivadaMock.mockResolvedValue(true);

    const resultado = await ativarAcesso(1, "vip", "sub_1", 29.9, "mensal");

    expect(resultado).toBe(true);
    expect(transactionMock).toHaveBeenCalledTimes(1);
    expect(adicionarMembroGrupoMock).toHaveBeenCalledWith("5511999999999", "vip");
    expect(enviarMensagemPrivadaMock).toHaveBeenCalledWith("5511999999999", "mensagem de boas-vindas", "vip");
    expect(enviarEmailBoasVindasMock).toHaveBeenCalledWith("maria@x.com", "Maria", "vip", "https://chat.whatsapp.com/grupo-vip");
    expect(alertarTelegramMock).not.toHaveBeenCalled();
    expect(sqlMock.mock.calls.some((c) => (c[0] as TemplateStringsArray).join(" ").includes("'sucesso'"))).toBe(true);
  });

  it("sem telefone cadastrado: alerta e não tenta WhatsApp", async () => {
    mockSqlPorTexto({
      "SELECT nome, email, telefone": [{ nome: "João", email: "joao@x.com", telefone: null }],
    });

    await ativarAcesso(2, "elite", "sub_2", 59.9, "mensal");

    expect(adicionarMembroGrupoMock).not.toHaveBeenCalled();
    expect(alertarTelegramMock).toHaveBeenCalledWith("🔴", "Cliente pagou mas não tem telefone cadastrado", expect.stringContaining("2"));
    expect(enviarMensagemPrivadaMock).not.toHaveBeenCalled();
  });

  it("falha ao adicionar no grupo: alerta e não manda mensagem de boas-vindas", async () => {
    mockSqlPorTexto({
      "SELECT nome, email, telefone": [{ nome: "Ana", email: "ana@x.com", telefone: "5511988888888" }],
    });
    adicionarMembroGrupoMock.mockResolvedValue(false);

    await ativarAcesso(3, "vip", "sub_3", 29.9, "mensal");

    expect(alertarTelegramMock).toHaveBeenCalledWith(
      "🔴",
      "Cliente pagou mas não entrou no grupo WhatsApp",
      expect.stringContaining("3")
    );
    expect(enviarMensagemPrivadaMock).not.toHaveBeenCalled();
  });

  it("assinatura duplicada (23505): alerta, loga 'duplicado', retorna false e não faz mais nada", async () => {
    transactionMock.mockRejectedValueOnce({ code: "23505" });

    const resultado = await ativarAcesso(4, "vip", "sub_4", 29.9, "mensal");

    expect(resultado).toBe(false);
    expect(alertarTelegramMock).toHaveBeenCalledWith(
      "🔴",
      "Assinatura duplicada detectada — estorno manual necessário",
      expect.any(String)
    );
    expect(sqlMock.mock.calls.some((c) => (c[0] as TemplateStringsArray).join(" ").includes("'duplicado'"))).toBe(true);
    expect(adicionarMembroGrupoMock).not.toHaveBeenCalled();
    expect(enviarEmailBoasVindasMock).not.toHaveBeenCalled();
  });

  // FASE 41b: antes da transaction, cancela PIX anual expirado para liberar
  // idx_assinaturas_usuario_ativa e evitar 23505 no caminho de renovação.
  it("cancela PIX anual expirado antes da transaction (evita 23505 na renovação)", async () => {
    mockSqlPorTexto({
      "SELECT nome, email, telefone": [{ nome: "Pedro", email: "pedro@x.com", telefone: "5511977777777" }],
      "SELECT id FROM grupos_whatsapp": [{ id: 5 }],
    });
    adicionarMembroGrupoMock.mockResolvedValue(true);
    enviarMensagemPrivadaMock.mockResolvedValue(true);

    await ativarAcesso(5, "vip", "sub_pix_novo", 99, "anual");

    // Deve ter tentado cancelar PIX anual expirado antes da transaction
    expect(
      sqlMock.mock.calls.some((c) =>
        (c[0] as TemplateStringsArray).join(" ").includes("UPDATE assinaturas SET status = 'cancelada'") &&
        (c[0] as TemplateStringsArray).join(" ").includes("ciclo = 'anual'") &&
        (c[0] as TemplateStringsArray).join(" ").includes("360 days")
      )
    ).toBe(true);
    expect(transactionMock).toHaveBeenCalledTimes(1);
  });
});
