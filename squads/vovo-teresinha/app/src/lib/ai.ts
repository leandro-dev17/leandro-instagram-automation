/**
 * Helper central de geração de texto via IA — Groq (grátis) → Cerebras (grátis).
 * Anthropic foi removido em 15/07/2026: chave excluída pelo usuário (mesma chave usada em
 * todos os squads) para parar cobrança recorrente no cartão. Sem fallback pago — se Groq e
 * Cerebras falharem, a chamada lança erro e a rota trata como indisponibilidade temporária.
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

const MODELO_LLAMA_GROQ = "llama-3.3-70b-versatile";
const MODELO_LLAMA_CEREBRAS = "llama-3.3-70b";

// Llama 3.3 70B servido via Groq/Cerebras (inferência ultrarrápida) ocasionalmente "vaza"
// tokens de outro alfabeto no meio do texto em português — efeito colateral conhecido desses
// provedores (mesmo comportamento já mitigado em squads/alerta-patriota/app/src/lib/ai.ts).
const REGEX_SCRIPT_NAO_PORTUGUES = /[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿ֐-׿ऀ-ॿ฀-๿]/;

export function contemScriptNaoPortugues(texto: string): boolean {
  return REGEX_SCRIPT_NAO_PORTUGUES.test(texto);
}

class ErroScriptInvalido extends Error {}

const INSTRUCAO_IDIOMA = "\n\nIMPORTANTE: responda inteiramente em português do Brasil. Nunca use caracteres de outros alfabetos (chinês, cirílico, árabe, etc.) em nenhuma parte do texto.";

export type MensagemIA = {
  max_tokens: number;
  system?: string;
  messages: { role: "user"; content: string }[];
};

function comInstrucaoIdioma(params: MensagemIA): MensagemIA {
  return { ...params, messages: params.messages.map((m) => ({ ...m, content: m.content + INSTRUCAO_IDIOMA })) };
}

// Provedores gratuitos (Groq/Cerebras) têm limite de tokens por minuto (TPM); ao bater no limite
// retornam 429 com header retry-after — esperamos e tentamos de novo antes de desistir desse provedor.
async function gerarComOpenAICompativel(
  nome: string,
  url: string,
  apiKey: string,
  modelo: string,
  params: MensagemIA,
  tentativa = 0
): Promise<string> {
  const mensagens = params.system
    ? [{ role: "system", content: params.system }, ...params.messages]
    : params.messages;

  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelo, messages: mensagens, max_tokens: params.max_tokens }),
    signal: AbortSignal.timeout(30000),
  });
  if (res.status === 429 && tentativa < 2) {
    const espera = Math.min(Math.ceil(Number(res.headers.get("retry-after")) || 10) * 1000, 30000);
    await new Promise((r) => setTimeout(r, espera));
    return gerarComOpenAICompativel(nome, url, apiKey, modelo, params, tentativa + 1);
  }
  if (!res.ok) throw new Error(`${nome} ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return (data.choices?.[0]?.message?.content || "").trim();
}

async function tentarGroq(params: MensagemIA): Promise<string> {
  const texto = await gerarComOpenAICompativel("Groq", "https://api.groq.com/openai/v1/chat/completions", GROQ_API_KEY!, MODELO_LLAMA_GROQ, params);
  if (contemScriptNaoPortugues(texto)) throw new ErroScriptInvalido("Groq retornou texto com caracteres de outro alfabeto");
  return texto;
}

async function tentarCerebras(params: MensagemIA): Promise<string> {
  const texto = await gerarComOpenAICompativel("Cerebras", "https://api.cerebras.ai/v1/chat/completions", CEREBRAS_API_KEY!, MODELO_LLAMA_CEREBRAS, params);
  if (contemScriptNaoPortugues(texto)) throw new ErroScriptInvalido("Cerebras retornou texto com caracteres de outro alfabeto");
  return texto;
}

/**
 * Gera texto de conteúdo/análise (respostas de bot, análises, achados de fiscal): tenta Groq,
 * depois Cerebras. Injeta instrução de idioma (não aplicável a geração de código, ver gerarCodigo).
 */
export async function gerarTexto(paramsOriginais: MensagemIA): Promise<string> {
  const params = comInstrucaoIdioma(paramsOriginais);
  const erros: string[] = [];

  if (GROQ_API_KEY) {
    try {
      return await tentarGroq(params);
    } catch (err) {
      erros.push(`Groq: ${String(err)}`);
    }
  }

  if (CEREBRAS_API_KEY) {
    try {
      return await tentarCerebras(params);
    } catch (err) {
      erros.push(`Cerebras: ${String(err)}`);
    }
  }

  throw new Error(`Groq e Cerebras falharam — ${erros.join(" | ")}`);
}

// ===== Tool-use agêntico (claude-resolver) =====
// Substitui o loop nativo Anthropic (tools + tool_use) pelo formato OpenAI-compatible que
// Groq/Cerebras suportam para Llama 3.3 70B: "function calling" com tool_calls/role:"tool".

export type DefinicaoFerramenta = {
  type: "function";
  function: { name: string; description: string; parameters: Record<string, unknown> };
};

export type ChamadaFerramenta = { nome: string; argumentos: Record<string, unknown>; resultado: unknown };

type MensagemFerramentas =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

async function rodarLoopFerramentas(
  url: string,
  apiKey: string,
  modelo: string,
  promptInicial: string,
  ferramentas: DefinicaoFerramenta[],
  executar: (nome: string, args: Record<string, unknown>) => Promise<unknown>,
  nomeFerramentaFinal: string,
  maxIteracoes: number
): Promise<{ relatorioFinal: Record<string, unknown> | null; historico: ChamadaFerramenta[] }> {
  const messages: MensagemFerramentas[] = [{ role: "user", content: promptInicial }];
  const historico: ChamadaFerramenta[] = [];
  let relatorioFinal: Record<string, unknown> | null = null;

  for (let i = 0; i < maxIteracoes; i++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: modelo, messages, tools: ferramentas, max_tokens: 4096 }),
      signal: AbortSignal.timeout(45000),
    });
    if (!res.ok) throw new Error(`${url} ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const msg = data.choices?.[0]?.message;
    if (!msg) throw new Error("Resposta sem choices[0].message");

    const chamadas = msg.tool_calls || [];
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: chamadas });
    if (chamadas.length === 0) break;

    for (const chamada of chamadas) {
      const nome = chamada.function.name;
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(chamada.function.arguments || "{}"); } catch { /* argumentos malformados, segue vazio */ }

      let resultado: unknown;
      try {
        resultado = await executar(nome, args);
      } catch (err) {
        resultado = `Erro: ${String(err).slice(0, 200)}`;
      }

      if (nome === nomeFerramentaFinal) relatorioFinal = args;
      historico.push({ nome, argumentos: args, resultado });

      messages.push({
        role: "tool",
        tool_call_id: chamada.id,
        content: typeof resultado === "string" ? resultado : JSON.stringify(resultado),
      });
    }

    if (relatorioFinal) break;
  }

  return { relatorioFinal, historico };
}

/**
 * Loop agêntico de tool-use: tenta rodar do zero via Groq; se Groq falhar (erro de rede/API,
 * não decisão de negócio), tenta de novo do zero via Cerebras. Ferramentas que alteram estado
 * (UPDATE...WHERE, redeploy) devem ser idempotentes o bastante para tolerar uma repetição rara
 * nesse cenário de fallback — não há como retomar o loop no meio em outro provedor.
 */
export async function gerarComFerramentas(params: {
  promptInicial: string;
  ferramentas: DefinicaoFerramenta[];
  executar: (nome: string, args: Record<string, unknown>) => Promise<unknown>;
  nomeFerramentaFinal: string;
  maxIteracoes?: number;
}): Promise<{ relatorioFinal: Record<string, unknown> | null; historico: ChamadaFerramenta[] }> {
  const { promptInicial, ferramentas, executar, nomeFerramentaFinal, maxIteracoes = 12 } = params;
  const erros: string[] = [];

  if (GROQ_API_KEY) {
    try {
      return await rodarLoopFerramentas(
        "https://api.groq.com/openai/v1/chat/completions", GROQ_API_KEY, MODELO_LLAMA_GROQ,
        promptInicial, ferramentas, executar, nomeFerramentaFinal, maxIteracoes
      );
    } catch (err) { erros.push(`Groq: ${String(err)}`); }
  }

  if (CEREBRAS_API_KEY) {
    try {
      return await rodarLoopFerramentas(
        "https://api.cerebras.ai/v1/chat/completions", CEREBRAS_API_KEY, MODELO_LLAMA_CEREBRAS,
        promptInicial, ferramentas, executar, nomeFerramentaFinal, maxIteracoes
      );
    } catch (err) { erros.push(`Cerebras: ${String(err)}`); }
  }

  throw new Error(`Groq e Cerebras falharam — ${erros.join(" | ")}`);
}

/**
 * Gera código (uso exclusivo do claude-revisor): tenta Groq → Cerebras, sem instrução de idioma
 * (evita interferir na saída, que deve ser só código). A rede de segurança contra código
 * quebrado/truncado é a validação feita em route.ts após a geração, não o provedor.
 */
export async function gerarCodigo(params: MensagemIA): Promise<string> {
  const erros: string[] = [];

  if (GROQ_API_KEY) {
    try {
      return await tentarGroq(params);
    } catch (err) {
      erros.push(`Groq: ${String(err)}`);
    }
  }

  if (CEREBRAS_API_KEY) {
    try {
      return await tentarCerebras(params);
    } catch (err) {
      erros.push(`Cerebras: ${String(err)}`);
    }
  }

  throw new Error(`Groq e Cerebras falharam — ${erros.join(" | ")}`);
}
