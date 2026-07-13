#!/usr/bin/env node
/**
 * ai-helper.cjs — Geração de texto via IA para os scripts de automação (GitHub Actions)
 * FASE 56: antes tentava Claude (Anthropic) primeiro e só caía pro Groq em erro de limite —
 * ordem invertida em relação ao lib/ai.ts do app Next.js. Agora segue o mesmo padrão de custo
 * zero: tenta Groq, depois Cerebras, sem nenhuma camada Anthropic (a pedido do usuário, para
 * eliminar o consumo pago residual do whatsapp-dossie.cjs, único script que usa este helper).
 */
'use strict';

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

const MODELO_LLAMA_GROQ = 'llama-3.3-70b-versatile';
const MODELO_LLAMA_CEREBRAS = 'llama-3.3-70b';

// Mapeia modelos Claude → equivalente Llama servido pelo Groq
const MODELO_FALLBACK = {
  'claude-haiku-4-5-20251001': MODELO_LLAMA_GROQ,
  'claude-sonnet-4-6': MODELO_LLAMA_GROQ,
};

// Llama 3.3 70B servido via Groq/Cerebras (inferência ultrarrápida) ocasionalmente "vaza"
// tokens de outro alfabeto no meio do texto em português — efeito colateral conhecido desses
// provedores (mesma checagem usada em lib/ai.ts). Detecta CJK/hangul/cirílico/árabe/hebraico/
// devanágari/tailandês para rejeitar a resposta e cair para o próximo provedor da cadeia.
const REGEX_SCRIPT_NAO_PORTUGUES = /[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿ֐-׿ऀ-ॿ฀-๿]/;

function contemScriptNaoPortugues(texto) {
  return REGEX_SCRIPT_NAO_PORTUGUES.test(texto);
}

// Provedores gratuitos (Groq/Cerebras) têm limite de tokens por minuto (TPM); ao bater no limite
// retornam 429 com header retry-after — esperamos e tentamos de novo antes de desistir desse provedor.
async function gerarComProvedorCompativel(nome, url, apiKey, modelo, params, tentativa = 0) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, messages: params.messages, max_tokens: params.max_tokens }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429 && tentativa < 2) {
    const espera = Math.min(Math.ceil(Number(res.headers.get('retry-after')) || 10) * 1000, 30000);
    await new Promise((r) => setTimeout(r, espera));
    return gerarComProvedorCompativel(nome, url, apiKey, modelo, params, tentativa + 1);
  }
  if (!res.ok) throw new Error(`${nome} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

/**
 * Gera texto tentando Groq e, se falhar/esgotar, Cerebras. Sem fallback pago (Anthropic).
 * @param {{model: string, max_tokens: number, messages: {role: string, content: string}[]}} params
 * @returns {Promise<string>}
 */
async function gerarTexto(params) {
  const modeloLlama = MODELO_FALLBACK[params.model] || MODELO_LLAMA_GROQ;
  const erros = [];

  if (GROQ_API_KEY) {
    try {
      const texto = await gerarComProvedorCompativel('Groq', 'https://api.groq.com/openai/v1/chat/completions', GROQ_API_KEY, modeloLlama, params);
      if (contemScriptNaoPortugues(texto)) throw new Error('Groq retornou texto com caracteres de outro alfabeto — vazamento de token conhecido do Llama via inferência rápida');
      return texto;
    } catch (err) {
      erros.push(`Groq: ${String(err)}`);
    }
  }

  if (CEREBRAS_API_KEY) {
    try {
      const texto = await gerarComProvedorCompativel('Cerebras', 'https://api.cerebras.ai/v1/chat/completions', CEREBRAS_API_KEY, MODELO_LLAMA_CEREBRAS, params);
      if (contemScriptNaoPortugues(texto)) throw new Error('Cerebras retornou texto com caracteres de outro alfabeto — vazamento de token conhecido do Llama via inferência rápida');
      return texto;
    } catch (err) {
      erros.push(`Cerebras: ${String(err)}`);
    }
  }

  throw new Error(`Groq e Cerebras falharam — ${erros.join(' | ')}`);
}

module.exports = { gerarTexto };
