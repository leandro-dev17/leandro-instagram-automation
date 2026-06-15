#!/usr/bin/env node
/**
 * ai-helper.cjs — Geração de texto via IA para os scripts de automação (GitHub Actions)
 * Mesma lógica do lib/ai.ts do app Next.js: tenta Claude (Anthropic) e, se a
 * cota estiver esgotada/limitada, cai para o Groq (Llama) automaticamente.
 */
'use strict';

const AnthropicMod = require('@anthropic-ai/sdk');
const Anthropic = AnthropicMod.default || AnthropicMod;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GROQ_API_KEY = process.env.GROQ_API_KEY;

// Mapeia modelos Claude → equivalente Groq para o fallback
const MODELO_FALLBACK = {
  'claude-haiku-4-5-20251001': 'llama-3.3-70b-versatile',
  'claude-sonnet-4-6': 'llama-3.3-70b-versatile',
};

function ehErroDeLimite(err) {
  const status = err?.status;
  if (status === 429 || status === 529 || status === 503) return true;

  const tipo = err?.error?.type;
  if (tipo === 'rate_limit_error' || tipo === 'overloaded_error') return true;

  const msg = String(err);
  return msg.includes('usage limit') || msg.includes('rate_limit') || msg.includes('429') || msg.includes('overloaded');
}

// Plano gratuito do Groq tem limite de tokens por minuto (TPM); ao bater no limite
// o Groq retorna 429 com header retry-after — esperamos e tentamos de novo.
async function gerarComGroq({ model, max_tokens, messages }, tentativa = 0) {
  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO_FALLBACK[model] || 'llama-3.3-70b-versatile',
      messages,
      max_tokens,
    }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429 && tentativa < 2) {
    const espera = Math.min(Math.ceil(Number(res.headers.get('retry-after')) || 10) * 1000, 30000);
    await new Promise((r) => setTimeout(r, espera));
    return gerarComGroq({ model, max_tokens, messages }, tentativa + 1);
  }
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Gera texto com Claude e, se a cota da Anthropic estiver esgotada, cai para o Groq.
 * @param {{model: string, max_tokens: number, messages: {role: string, content: string}[]}} params
 * @returns {Promise<string>}
 */
async function gerarTexto(params) {
  try {
    const resposta = await anthropic.messages.create({
      model: params.model,
      max_tokens: params.max_tokens,
      messages: params.messages,
    });
    return resposta.content[0].type === 'text' ? resposta.content[0].text.trim() : '';
  } catch (err) {
    if (!GROQ_API_KEY || !ehErroDeLimite(err)) throw err;
    try {
      return await gerarComGroq(params);
    } catch (errGroq) {
      throw new Error(`Anthropic e Groq falharam — Anthropic: ${String(err)} | Groq: ${String(errGroq)}`);
    }
  }
}

module.exports = { gerarTexto };
