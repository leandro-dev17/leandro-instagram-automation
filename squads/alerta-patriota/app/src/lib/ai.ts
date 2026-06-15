/**
 * Helper central de geração de texto via IA.
 * Tenta Claude (Anthropic) primeiro. Se a conta bater no limite de uso/cota,
 * cai automaticamente para o Groq (plano gratuito, modelos Llama) para não parar a esteira de conteúdo.
 */
import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Mapeia modelos Claude → equivalente Groq para o fallback
const MODELO_FALLBACK: Record<string, string> = {
  "claude-haiku-4-5-20251001": "llama-3.1-8b-instant",
  "claude-sonnet-4-6": "llama-3.3-70b-versatile",
};

function ehErroDeLimite(err: unknown): boolean {
  // A SDK da Anthropic expõe `status` (429/529) e `error.type` (rate_limit_error/overloaded_error)
  // como campos do objeto de erro, não necessariamente no texto — checa ambos antes de cair no fallback de string.
  const status = (err as { status?: number })?.status;
  if (status === 429 || status === 529 || status === 503) return true;

  const tipo = (err as { error?: { type?: string } })?.error?.type;
  if (tipo === "rate_limit_error" || tipo === "overloaded_error") return true;

  const msg = String(err);
  return msg.includes("usage limit") || msg.includes("rate_limit") || msg.includes("429") || msg.includes("overloaded");
}

export type MensagemIA = { model: string; max_tokens: number; messages: { role: "user"; content: string }[] };

// Plano gratuito do Groq tem limite de tokens por minuto (TPM); ao bater no limite
// o Groq retorna 429 com header retry-after — esperamos e tentamos de novo.
async function gerarComGroq(params: MensagemIA, tentativa = 0): Promise<string> {
  const res = await fetch("https://api.groq.com/openai/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: MODELO_FALLBACK[params.model] || "llama-3.3-70b-versatile",
      messages: params.messages,
      max_tokens: params.max_tokens,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429 && tentativa < 2) {
    const espera = Math.min(Math.ceil(Number(res.headers.get("retry-after")) || 10) * 1000, 30000);
    await new Promise((r) => setTimeout(r, espera));
    return gerarComGroq(params, tentativa + 1);
  }
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

/**
 * Gera texto com Claude e, se a cota da Anthropic estiver esgotada, cai para o Groq.
 * Retorna o texto já extraído (trim aplicado).
 */
export async function gerarTexto(params: MensagemIA): Promise<string> {
  try {
    const resposta = await anthropic.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages,
    });
    return resposta.content[0].type === "text" ? resposta.content[0].text.trim() : "";
  } catch (err) {
    if (!GROQ_API_KEY || !ehErroDeLimite(err)) throw err;
    try {
      return await gerarComGroq(params);
    } catch (errGroq) {
      throw new Error(`Anthropic e Groq falharam — Anthropic: ${String(err)} | Groq: ${String(errGroq)}`);
    }
  }
}
