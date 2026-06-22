/**
 * Helper central de geração de texto via IA.
 * Ordem para conteúdo de rotina: Groq (grátis) → Cerebras (grátis) → Anthropic (pago, último recurso).
 * Anthropic fica como rede de segurança paga porque os dois tiers gratuitos têm teto fixo diário e
 * podem esgotar juntos se o volume da automação crescer (foi o que já aconteceu quando só existia
 * Anthropic + Groq). Ver squads/alerta-patriota/PLANO-CORRECAO.md (Fase 9).
 *
 * Disjuntor: toda chamada ao Anthropic é registrada em `consumo_ia_log` por agente de origem.
 * Se um mesmo agente passar de LIMITE_DISJUNTOR_ANTHROPIC chamadas em JANELA_DISJUNTOR_MINUTOS,
 * novas chamadas dele ao Anthropic são bloqueadas automaticamente e um alerta é enviado por WhatsApp
 * — proteção direta contra o incidente que esgotou o crédito Anthropic (agente em loop chamando a API).
 */
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { enviarMensagemPrivada } from "@/lib/whatsapp";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const GROQ_API_KEY = process.env.GROQ_API_KEY;
const CEREBRAS_API_KEY = process.env.CEREBRAS_API_KEY;

const LIMITE_DISJUNTOR_ANTHROPIC = 20;
const JANELA_DISJUNTOR_MINUTOS = 10;

const MODELO_LLAMA_GROQ = "llama-3.3-70b-versatile";
const MODELO_LLAMA_CEREBRAS = "llama-3.3-70b";

// Mapeia modelos Claude → equivalente Llama para os fallbacks gratuitos
const MODELO_FALLBACK: Record<string, string> = {
  "claude-haiku-4-5-20251001": MODELO_LLAMA_GROQ,
  "claude-sonnet-4-6": MODELO_LLAMA_GROQ,
};

// Llama 3.3 70B servido via Groq/Cerebras (inferência ultrarrápida) ocasionalmente "vaza"
// tokens de outro alfabeto no meio do texto em português — efeito colateral conhecido desses
// provedores. Detecta CJK/hangul/cirílico/árabe/hebraico/devanágari/tailandês para rejeitar
// e cair para o próximo provedor da cadeia antes que o texto chegue ao WhatsApp.
const REGEX_SCRIPT_NAO_PORTUGUES = /[一-鿿぀-ヿ가-힯Ѐ-ӿ؀-ۿ֐-׿ऀ-ॿ฀-๿]/;

function contemScriptNaoPortugues(texto: string): boolean {
  return REGEX_SCRIPT_NAO_PORTUGUES.test(texto);
}

class ErroScriptInvalido extends Error {}

const INSTRUCAO_IDIOMA = "\n\nIMPORTANTE: responda inteiramente em português do Brasil. Nunca use caracteres de outros alfabetos (chinês, cirílico, árabe, etc.) em nenhuma parte do texto.";

function comInstrucaoIdioma(params: MensagemIA): MensagemIA {
  return { ...params, messages: params.messages.map((m) => ({ ...m, content: m.content + INSTRUCAO_IDIOMA })) };
}

function ehErroRecuperavel(err: unknown): boolean {
  // A SDK da Anthropic expõe `status` (429/529) e `error.type` (rate_limit_error/overloaded_error)
  // como campos do objeto de erro; os fallbacks via fetch (Groq/Cerebras) embutem o status no texto
  // da mensagem de erro — checa os dois formatos antes de decidir se vale tentar o próximo provedor.
  const status = (err as { status?: number })?.status;
  if (status && [429, 500, 502, 503, 529].includes(status)) return true;

  const tipo = (err as { error?: { type?: string } })?.error?.type;
  if (tipo === "rate_limit_error" || tipo === "overloaded_error") return true;

  const msg = String(err);
  return /usage limit|rate_limit|overloaded|\b(429|500|502|503|529)\b/.test(msg);
}

export type MensagemIA = {
  model: string;
  max_tokens: number;
  messages: { role: "user"; content: string }[];
  /** Nome do agente/cron de origem (ex: "bernardo-resumidor") — usado pelo log de consumo e pelo disjuntor */
  agente: string;
};

async function registrarConsumo(agente: string, provedor: string, status: string): Promise<void> {
  try {
    await sql`INSERT INTO consumo_ia_log (agente, provedor, status) VALUES (${agente}, ${provedor}, ${status})`;
  } catch {
    // log de consumo nunca deve impedir a geração de texto em si
  }
}

async function disjuntorAcionado(agente: string): Promise<boolean> {
  try {
    const r = await sql`
      SELECT COUNT(*)::int AS total FROM consumo_ia_log
      WHERE agente = ${agente} AND provedor = 'anthropic' AND status != 'bloqueado'
        AND created_at > NOW() - INTERVAL '10 minutes'
    `;
    return Number(r[0]?.total || 0) >= LIMITE_DISJUNTOR_ANTHROPIC;
  } catch {
    return false; // falha ao consultar o log não deve travar a geração de texto
  }
}

async function alertarDisjuntor(agente: string): Promise<void> {
  try {
    const jaAlertou = await sql`
      SELECT id FROM consumo_ia_log
      WHERE agente = ${agente} AND status = 'bloqueado' AND created_at > NOW() - INTERVAL '10 minutes'
      LIMIT 1
    `;
    if (jaAlertou.length > 0) return; // evita reenviar o mesmo alerta a cada chamada bloqueada

    const numero = process.env.ADMIN_WHATSAPP_NUMERO || "";
    if (!numero) return;
    await enviarMensagemPrivada(
      numero,
      `🚨 *DISJUNTOR DE IA ACIONADO*\n\nAgente: ${agente}\nMotivo: mais de ${LIMITE_DISJUNTOR_ANTHROPIC} chamadas ao Anthropic em ${JANELA_DISJUNTOR_MINUTOS} minutos.\n\nChamadas desse agente ao Anthropic foram bloqueadas automaticamente até o ritmo normalizar (a contagem decai sozinha após ${JANELA_DISJUNTOR_MINUTOS} min sem novas tentativas).\n\nVerifique: alertapatriota.vercel.app/admin`
    );
  } catch {
    // alerta nunca deve derrubar o fluxo principal
  }
}

async function gerarComAnthropicComDisjuntor(agente: string, params: MensagemIA): Promise<string> {
  if (await disjuntorAcionado(agente)) {
    await alertarDisjuntor(agente);
    await registrarConsumo(agente, "anthropic", "bloqueado");
    throw new Error(`Disjuntor acionado: agente "${agente}" excedeu ${LIMITE_DISJUNTOR_ANTHROPIC} chamadas ao Anthropic em ${JANELA_DISJUNTOR_MINUTOS} min — bloqueado automaticamente`);
  }

  try {
    const texto = await gerarComAnthropic(params);
    await registrarConsumo(agente, "anthropic", "sucesso");
    return texto;
  } catch (err) {
    await registrarConsumo(agente, "anthropic", "erro");
    throw err;
  }
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
  const res = await fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ model: modelo, messages: params.messages, max_tokens: params.max_tokens }),
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

async function gerarComAnthropic(params: MensagemIA): Promise<string> {
  const resposta = await anthropic.messages.create({
    model: params.model,
    max_tokens: params.max_tokens,
    messages: params.messages,
  });
  return resposta.content[0].type === "text" ? resposta.content[0].text.trim() : "";
}

/**
 * Gera texto para conteúdo de rotina (resumos, respostas de bot, cards): tenta Groq, depois
 * Cerebras, e só recorre ao Anthropic (pago) se os dois gratuitos também falharem/esgotarem.
 * Retorna o texto já extraído (trim aplicado).
 */
export async function gerarTexto(paramsOriginais: MensagemIA): Promise<string> {
  const params = comInstrucaoIdioma(paramsOriginais);
  const erros: string[] = [];
  const modeloLlama = MODELO_FALLBACK[params.model] || MODELO_LLAMA_GROQ;

  if (GROQ_API_KEY) {
    try {
      const texto = await gerarComOpenAICompativel("Groq", "https://api.groq.com/openai/v1/chat/completions", GROQ_API_KEY, modeloLlama, params);
      if (contemScriptNaoPortugues(texto)) throw new ErroScriptInvalido("Groq retornou texto com caracteres de outro alfabeto — vazamento de token conhecido do Llama via inferência rápida");
      await registrarConsumo(params.agente, "groq", "sucesso");
      return texto;
    } catch (err) {
      await registrarConsumo(params.agente, "groq", "erro");
      if (!(err instanceof ErroScriptInvalido) && !ehErroRecuperavel(err)) throw err;
      erros.push(`Groq: ${String(err)}`);
    }
  }

  if (CEREBRAS_API_KEY) {
    try {
      const texto = await gerarComOpenAICompativel("Cerebras", "https://api.cerebras.ai/v1/chat/completions", CEREBRAS_API_KEY, MODELO_LLAMA_CEREBRAS, params);
      if (contemScriptNaoPortugues(texto)) throw new ErroScriptInvalido("Cerebras retornou texto com caracteres de outro alfabeto — vazamento de token conhecido do Llama via inferência rápida");
      await registrarConsumo(params.agente, "cerebras", "sucesso");
      return texto;
    } catch (err) {
      await registrarConsumo(params.agente, "cerebras", "erro");
      if (!(err instanceof ErroScriptInvalido) && !ehErroRecuperavel(err)) throw err;
      erros.push(`Cerebras: ${String(err)}`);
    }
  }

  try {
    const texto = await gerarComAnthropicComDisjuntor(params.agente, params);
    if (contemScriptNaoPortugues(texto)) throw new Error("Anthropic retornou texto com caracteres de outro alfabeto");
    return texto;
  } catch (err) {
    erros.push(`Anthropic: ${String(err)}`);
    throw new Error(`Groq, Cerebras e Anthropic falharam — ${erros.join(" | ")}`);
  }
}

/**
 * Geração de código (uso exclusivo do claude-revisor): sempre via Anthropic, sem fallback para
 * Llama. Modelos abertos têm taxa de erro maior em código TypeScript válido, e esse agente já
 * corrompeu arquivos de produção mesmo usando Claude — não vale o risco de piorar isso pra economizar.
 * Passa pelo mesmo disjuntor: se o próprio claude-revisor entrar em loop, também é bloqueado.
 */
export async function gerarCodigoComClaude(params: MensagemIA): Promise<string> {
  return await gerarComAnthropicComDisjuntor(params.agente, params);
}
