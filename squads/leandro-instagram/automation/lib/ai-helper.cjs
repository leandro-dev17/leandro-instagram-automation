/**
 * Helper central de geração via IA — Groq (grátis) → Cerebras (grátis).
 * Anthropic foi removido: chave excluída pelo usuário (mesma chave usada em todos os
 * squads) para parar cobrança recorrente no cartão. Sem fallback pago — se Groq e
 * Cerebras falharem, a chamada lança erro e quem chamou trata como indisponibilidade
 * temporária (cada script já tinha seu próprio fallback de conteúdo fixo, preservado).
 *
 * Chaves dedicadas deste squad (GROQ_API_KEY / CEREBRAS_API_KEY), não compartilhadas
 * com Alerta Patriota nem Vovó Teresinha — mesmo repositório GitHub, secrets distintos.
 */

// Lidas a cada chamada (não uma vez no load do módulo): alguns scripts deste squad
// fazem require('./lib/kie.cjs') → require('./ai-helper.cjs') antes de carregar o
// .env no process.env (cada script tem seu próprio loader manual de .env, nem todos
// rodam antes desse require) — ler em tempo de chamada evita depender dessa ordem.
function getGroqKey() { return process.env.GROQ_API_KEY || ''; }
function getCerebrasKey() { return process.env.CEREBRAS_API_KEY || ''; }

const MODELO_LLAMA_GROQ = 'llama-3.3-70b-versatile';
const MODELO_LLAMA_CEREBRAS = 'llama-3.3-70b';

// Modelo com suporte a imagem (QC de visão) — só Groq tem free tier com isso hoje.
// qwen/qwen3.6-27b é o modelo multimodal recomendado pela Groq (jul/2026); é preview,
// não uso de produção crítico — mas os 2 call-sites de QC já falham "aberto" (aprovam
// a imagem) se a chamada der erro, então uma eventual instabilidade não trava o pipeline.
const MODELO_VISAO_GROQ = 'qwen/qwen3.6-27b';

// Llama 3.3 70B servido via Groq/Cerebras (inferência ultrarrápida) ocasionalmente "vaza"
// tokens de outro alfabeto no meio do texto em português — efeito colateral conhecido desses
// provedores (mesmo comportamento já mitigado em squads/vovo-teresinha e squads/alerta-patriota).
const REGEX_SCRIPT_NAO_PORTUGUES = /[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿ֐-׿ऀ-ॿ฀-๿]/;

function contemScriptNaoPortugues(texto) {
  return REGEX_SCRIPT_NAO_PORTUGUES.test(texto);
}

async function chamarOpenAICompativel(url, apiKey, modelo, messages, maxTokens, tentativa = 0) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: modelo, messages, max_tokens: Math.min(maxTokens, 8000) }),
    signal: AbortSignal.timeout(45000),
  });
  if (res.status === 429 && tentativa < 2) {
    const espera = Math.min(Math.ceil(Number(res.headers.get('retry-after')) || 10) * 1000, 30000);
    await new Promise((r) => setTimeout(r, espera));
    return chamarOpenAICompativel(url, apiKey, modelo, messages, maxTokens, tentativa + 1);
  }
  if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || '').trim();
}

async function tentarGroq(prompt, maxTokens) {
  const texto = await chamarOpenAICompativel(
    'https://api.groq.com/openai/v1/chat/completions', getGroqKey(), MODELO_LLAMA_GROQ,
    [{ role: 'user', content: prompt }], maxTokens
  );
  if (contemScriptNaoPortugues(texto)) throw new Error('Groq retornou texto com caracteres de outro alfabeto');
  return texto;
}

async function tentarCerebras(prompt, maxTokens) {
  const texto = await chamarOpenAICompativel(
    'https://api.cerebras.ai/v1/chat/completions', getCerebrasKey(), MODELO_LLAMA_CEREBRAS,
    [{ role: 'user', content: prompt }], maxTokens
  );
  if (contemScriptNaoPortugues(texto)) throw new Error('Cerebras retornou texto com caracteres de outro alfabeto');
  return texto;
}

/**
 * Gera texto (equivalente a response.content[0].text da Anthropic): tenta Groq, depois
 * Cerebras. Retorna a string pronta — quem chama continua fazendo o mesmo parsing de
 * JSON/regex que já fazia em cima do texto retornado pela Anthropic antes.
 */
async function gerarTexto(prompt, maxTokens = 2000) {
  const erros = [];

  if (getGroqKey()) {
    try {
      return await tentarGroq(prompt, maxTokens);
    } catch (err) {
      erros.push(`Groq: ${err}`);
    }
  }

  if (getCerebrasKey()) {
    try {
      return await tentarCerebras(prompt, maxTokens);
    } catch (err) {
      erros.push(`Cerebras: ${err}`);
    }
  }

  throw new Error(`Groq e Cerebras falharam — ${erros.join(' | ')}`);
}

/**
 * QC de imagem (visão): substitui as chamadas Claude Vision de lib/kie.cjs e
 * test-together.cjs. Só Groq tem modelo multimodal grátis hoje — sem fallback Cerebras
 * aqui. Quem chama já trata qualquer erro como "aprovado" (fail-open), então não
 * duplicamos essa lógica dentro do helper.
 */
async function gerarComVisao(prompt, imageBase64, maxTokens = 200) {
  const apiKey = getGroqKey();
  if (!apiKey) throw new Error('GROQ_API_KEY não configurada — QC de visão indisponível');
  const messages = [{
    role: 'user',
    content: [
      { type: 'text', text: prompt },
      { type: 'image_url', image_url: { url: `data:image/png;base64,${imageBase64}` } },
    ],
  }];
  return chamarOpenAICompativel(
    'https://api.groq.com/openai/v1/chat/completions', apiKey, MODELO_VISAO_GROQ,
    messages, maxTokens
  );
}

module.exports = { gerarTexto, gerarComVisao, contemScriptNaoPortugues };
