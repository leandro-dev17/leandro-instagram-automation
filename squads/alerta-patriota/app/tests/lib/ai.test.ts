import { describe, it, expect, vi } from "vitest";

// ai.ts importa @/lib/db e @/lib/whatsapp no topo do arquivo — ambos lançam exceção
// no carregamento do módulo se as env vars (DATABASE_URL, EVOLUTION_API_URL etc.) não
// estiverem configuradas. Como este teste só exercita a função pura de detecção de
// script não-português, mockamos as duas dependências em vez de configurar env reais.
vi.mock("@/lib/db", () => ({ sql: vi.fn() }));
vi.mock("@/lib/whatsapp", () => ({ enviarMensagemPrivada: vi.fn() }));

const { contemScriptNaoPortugues } = await import("@/lib/ai");

// Fase 19: Llama 3.3 70B servido via Groq/Cerebras ocasionalmente vaza tokens de outro
// alfabeto no meio do texto em português — este filtro é o que detecta e descarta a resposta.
describe("contemScriptNaoPortugues", () => {
  it("não acusa texto 100% em português, incluindo acentos", () => {
    expect(contemScriptNaoPortugues("Capitão Braga: a verdade que a mídia esconde sobre a economia.")).toBe(false);
  });

  it("não acusa pontuação, números e símbolos comuns", () => {
    expect(contemScriptNaoPortugues("R$ 1.234,56 — 100% real (Art. 5º), 'aspas' \"duplas\"!")).toBe(false);
  });

  it("detecta caracteres CJK (chinês/japonês) vazados", () => {
    expect(contemScriptNaoPortugues("O presidente disse que 中国 vai investir mais.")).toBe(true);
  });

  it("detecta cirílico vazado", () => {
    expect(contemScriptNaoPortugues("A reunião terminou às привет 10h da manhã.")).toBe(true);
  });

  it("detecta árabe vazado", () => {
    expect(contemScriptNaoPortugues("Análise مرحبا sobre o cenário econômico.")).toBe(true);
  });

  it("detecta hangul (coreano) vazado", () => {
    expect(contemScriptNaoPortugues("Isso é 안녕하세요 importante para o Brasil.")).toBe(true);
  });

  it("detecta um único caractere de script estrangeiro perdido no meio de uma frase longa", () => {
    expect(contemScriptNaoPortugues("Texto longo e normal em português até aqui é tudo certo então 一 de repente aparece isso.")).toBe(true);
  });
});
