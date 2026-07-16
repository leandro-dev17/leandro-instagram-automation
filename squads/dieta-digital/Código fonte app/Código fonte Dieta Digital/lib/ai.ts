// Helper central de geração via IA — Groq (grátis), sem fallback pago.
// Anthropic foi removido: chave excluída pelo usuário para parar cobrança recorrente
// no cartão. Este squad não tem chave Cerebras própria (limite de 4 chaves grátis por
// conta já esgotado pelos outros squads), então aqui é Groq-only — se faltar, a chamada
// lança erro e a rota trata como indisponibilidade temporária.

const GROQ_API_KEY = process.env.GROQ_API_KEY

// Mapeia os antigos nomes de modelo Claude (mantidos nos call-sites) → modelo Groq real.
// 'claude-opus-4-8' usa o llama-3.3-70b-versatile: nessa conta o limite de TPM
// dele (12000) é maior que o do 8b-instant (6000), e o JSON de dieta precisa
// de bastante espaço de resposta (max_tokens).
const MODELO_FALLBACK: Record<string, string> = {
  'claude-haiku-4-5': 'llama-3.1-8b-instant',
  'claude-opus-4-8': 'llama-3.3-70b-versatile',
}

async function gerarComGroq(model: string, maxTokens: number, prompt: string): Promise<string> {
  if (!GROQ_API_KEY) throw new Error('GROQ_API_KEY não configurada')

  const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${GROQ_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model: MODELO_FALLBACK[model] || 'llama-3.3-70b-versatile',
      messages: [{ role: 'user', content: prompt }],
      // Limite de TPM do Groq é bem menor que o da Anthropic — não repassar maxTokens gigantes (ex: 32000)
      max_tokens: Math.min(maxTokens, 8000),
    }),
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) throw new Error(`Groq ${res.status}: ${await res.text()}`)
  const data = await res.json()
  return (data.choices?.[0]?.message?.content ?? '').trim()
}

/** Gera texto a partir de um prompt simples via Groq. */
export async function gerarTexto(model: string, maxTokens: number, prompt: string): Promise<string> {
  return gerarComGroq(model, maxTokens, prompt)
}

/**
 * Gera texto a partir de um PDF + prompt. O Groq não lê PDF diretamente (sem
 * suporte a documento/imagem), então extrai o texto do PDF localmente e manda
 * só o texto — perde leitura de layout/imagens, mas mantém a esteira funcionando.
 */
export async function gerarComPdf(model: string, maxTokens: number, prompt: string, pdfBase64: string): Promise<string> {
  const { extractText, getDocumentProxy } = await import('unpdf')
  const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(pdfBase64, 'base64')))
  const { text } = await extractText(pdf, { mergePages: true })
  // Limite de TPM do Groq é bem menor que o da Anthropic — truncar para caber prompt + texto + resposta
  const pdfText = text.length > 24000 ? text.slice(0, 24000) : text
  const promptComTexto = `${prompt}\n\n--- CONTEÚDO DO PDF (texto extraído, sem layout/imagens) ---\n${pdfText}`
  return gerarComGroq(model, maxTokens, promptComTexto)
}
