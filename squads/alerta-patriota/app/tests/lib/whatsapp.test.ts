import { describe, it, expect, vi, beforeEach } from "vitest";

// Fase 11: a Evolution API v1.8.6 exigia campos aninhados em `textMessage`/`mediaMessage`.
// Fase 20: a migração pra v2.3.7 removeu esses wrappers — os campos passaram a ficar soltos
// na raiz do body. Voltar a aninhar (ou aninhar quando não devia) quebra o envio silenciosamente
// (a Evolution aceita o POST mas não entrega a mensagem). Estes testes travam o formato certo.

vi.mock("@/lib/db", () => ({ sql: vi.fn(() => Promise.resolve([{ ultimo_envio: new Date() }])) }));
vi.mock("@/lib/telegram", () => ({ alertarTelegram: vi.fn(() => Promise.resolve()) }));

process.env.EVOLUTION_API_URL = "https://evo.test";
process.env.EVOLUTION_API_KEY = "test-key";
process.env.WPP_GROUP_VIP = "vip-group@g.us";
process.env.WPP_GROUP_ELITE = "elite-group@g.us";

const { enviarMensagemGrupo, enviarMensagemPrivada, enviarEnqueteGrupo } = await import("@/lib/whatsapp");

describe("payload da Evolution API — lib/whatsapp.ts", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("enviarMensagemGrupo manda body achatado, sem wrapper textMessage", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await enviarMensagemGrupo("vip", "Olá grupo");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://evo.test/message/sendText/alertapatriota");
    const body = JSON.parse(options.body);
    expect(body).toEqual({ number: "vip-group@g.us", text: "Olá grupo" });
    expect(body.textMessage).toBeUndefined();
  });

  it("enviarMensagemPrivada manda body achatado e número formatado como JID", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await enviarMensagemPrivada("(55) 47 99999-1234", "Mensagem privada");

    const [, options] = fetchMock.mock.calls[0];
    const body = JSON.parse(options.body);
    expect(body).toEqual({ number: "5547999991234@s.whatsapp.net", text: "Mensagem privada" });
  });

  it("enviarEnqueteGrupo manda body achatado, sem wrapper", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    await enviarEnqueteGrupo("elite", "Pergunta?", ["Sim", "Não"]);

    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe("https://evo.test/message/sendPoll/alertapatriota");
    const body = JSON.parse(options.body);
    expect(body).toEqual({ number: "elite-group@g.us", name: "Pergunta?", selectableCount: 1, values: ["Sim", "Não"] });
  });

  it("tenta de novo uma vez em falha HTTP antes de desistir", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 500 })
      .mockResolvedValueOnce({ ok: true });
    vi.stubGlobal("fetch", fetchMock);

    const ok = await enviarMensagemGrupo("vip", "Retry test");

    expect(ok).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
