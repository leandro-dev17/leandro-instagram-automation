/**
 * claude-renderer.cjs
 * Usa a Claude API (Haiku) para gerar layouts HTML dinâmicos para posts e reels.
 *
 * Abordagem 1 — Claude gera HTML completo (máxima criatividade)
 * Abordagem 2 — Claude escolhe entre templates + customiza
 * Abordagem 3 — Claude refina HTML existente (ajustes finos)
 */

const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const ENV_PATH = path.join(__dirname, '../../.env');

function loadEnv() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim()) env[k.trim()] = v.join('=').trim();
  }
  return env;
}

function getClient() {
  const env = loadEnv();
  if (!env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY não encontrada no .env');
  return new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
}

// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function imgToDataUrl(imgPath) {
  const data = fs.readFileSync(imgPath);
  return `data:image/png;base64,${data.toString('base64')}`;
}

// ─── ABORDAGEM 1 — HTML COMPLETO GERADO PELO CLAUDE ──────────────────────────
// Claude recebe os dados do post e gera o HTML inteiro do zero.
// Resultado: layout único e criativo para cada post.

async function generateFullHTML(postData, bgImagePath, format = 'post') {
  const client = getClient();

  const dimensions = format === 'reel'
    ? { width: 1080, height: 1920, desc: '9:16 vertical (Instagram Reel)' }
    : { width: 1080, height: 1440, desc: '4:3 quadrado (Instagram Feed)' };

  // Claude gera o HTML com placeholder — a imagem real é inserida depois
  const prompt = `Você é um designer de Instagram especializado em fitness feminino brasileiro.
Crie um layout HTML completo e visualmente impactante para um post do @leandro_personall.

DADOS DO POST:
- Tipo: ${postData.type}
- Headline: ${postData.headline}
- Palavra destaque (accent): ${postData.accent || ''}
- Corpo do texto: ${postData.body}
- CTA: ${postData.cta || ''}

ESPECIFICAÇÕES TÉCNICAS:
- Dimensões: ${dimensions.width}x${dimensions.height}px (${dimensions.desc})
- Use exatamente __BG_URL__ como valor do background-image no CSS (será substituído pela imagem real)
- Use Google Fonts (Inter ou Montserrat)
- Paleta: fundo escuro (#1A1F36 navy), destaque coral (#E8614A), texto branco
- A palavra "${postData.accent || ''}" no headline deve ter <span class="accent"> em coral (#E8614A)
- Handle @leandro_personall no canto superior direito
- Tag do tipo em pílula coral

REGRAS DE DESIGN:
- Overlay gradiente escuro na base para o texto ser legível sobre a foto
- Headline grande e bold (font-weight: 900)
- Corpo do texto menor, com opacidade 0.82
- CTA em caixa com borda sutil ou fundo semitransparente
- Layout editorial de revista fitness brasileira
- Varie a composição — texto embaixo, laterais, ou enquadrado. Seja criativo!

IMPORTANTE: Retorne APENAS o HTML completo, sem explicações, sem markdown, sem \`\`\`.
Comece com <!DOCTYPE html>. Use __BG_URL__ exatamente como está para o background.`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{ role: 'user', content: prompt }]
  });

  let html = response.content[0].text.trim();
  if (!html.startsWith('<!DOCTYPE') && !html.startsWith('<html')) {
    const start = html.indexOf('<!DOCTYPE');
    if (start > -1) html = html.substring(start);
  }

  // Substitui o placeholder pela imagem real
  const bgUrl = imgToDataUrl(bgImagePath);
  return html.replace(/__BG_URL__/g, bgUrl);
}

// ─── ABORDAGEM 2 — CLAUDE ESCOLHE TEMPLATE + CUSTOMIZA ───────────────────────
// Temos múltiplos templates base. Claude escolhe o mais adequado e customiza
// cores, tamanhos e composição baseado no conteúdo.

const TEMPLATE_VARIANTS = {
  // Template A: texto embaixo, imagem domina o topo (padrão atual melhorado)
  bottom_text: (data, bgUrl, dims) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${dims.w}px; height:${dims.h}px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(26,31,54,0.08) 0%, rgba(26,31,54,0.2) 35%, rgba(26,31,54,0.85) 62%, rgba(26,31,54,0.98) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; justify-content:flex-end; padding:${dims.p}px; }
  .handle { position:absolute; top:${dims.top}px; right:${dims.p}px; font-size:${dims.sm}px; font-weight:400; color:rgba(248,246,241,0.65); }
  .tag { display:inline-block; background:${data.tagColor||'#E8614A'}; color:#F8F6F1; font-size:${dims.tag}px; font-weight:700; padding:8px 22px; border-radius:100px; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:${dims.gap}px; align-self:flex-start; }
  h1 { font-size:${dims.h1}px; font-weight:900; color:#F8F6F1; line-height:1.02; margin-bottom:${dims.gap}px; }
  .accent { color:${data.accentColor||'#E8614A'}; }
  .body { font-size:${dims.body}px; font-weight:400; color:rgba(248,246,241,0.82); line-height:1.55; margin-bottom:${dims.gap*1.2|0}px; }
  .cta-box { background:rgba(248,246,241,0.1); border:1.5px solid rgba(248,246,241,0.18); border-radius:12px; padding:${dims.gap*0.8|0}px ${dims.gap}px; }
  .cta-text { font-size:${dims.cta}px; font-weight:600; color:rgba(248,246,241,0.88); }
</style>
</head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <span class="tag">${data.tagLabel}</span>
    <h1>${data.headlineHTML}</h1>
    <p class="body">${data.body}</p>
    <div class="cta-box"><p class="cta-text">${data.cta}</p></div>
  </div>
</body></html>`,

  // Template B: split — texto à esquerda, imagem mais ao centro
  split_left: (data, bgUrl, dims) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${dims.w}px; height:${dims.h}px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#1A1F36; }
  .bg { position:absolute; right:0; top:0; width:65%; height:100%; background-image:url('${bgUrl}'); background-size:cover; background-position:center; }
  .overlay-side { position:absolute; right:0; top:0; width:65%; height:100%; background:linear-gradient(to left, rgba(26,31,54,0.1) 0%, rgba(26,31,54,0.7) 60%, rgba(26,31,54,1) 100%); }
  .overlay-full { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(26,31,54,0) 60%, rgba(26,31,54,0.96) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; justify-content:center; padding:${dims.p}px; }
  .handle { position:absolute; top:${dims.top}px; right:${dims.p}px; font-size:${dims.sm}px; color:rgba(248,246,241,0.55); }
  .tag { display:inline-block; background:${data.tagColor||'#E8614A'}; color:#F8F6F1; font-size:${dims.tag}px; font-weight:700; padding:8px 22px; border-radius:100px; text-transform:uppercase; letter-spacing:1.5px; margin-bottom:${dims.gap}px; align-self:flex-start; }
  h1 { font-size:${dims.h1*0.9|0}px; font-weight:900; color:#F8F6F1; line-height:1.05; margin-bottom:${dims.gap}px; max-width:55%; }
  .accent { color:${data.accentColor||'#E8614A'}; }
  .body { font-size:${dims.body}px; color:rgba(248,246,241,0.8); line-height:1.55; max-width:52%; margin-bottom:${dims.gap}px; }
  .divider { width:80px; height:5px; background:#E8614A; border-radius:3px; margin-bottom:${dims.gap}px; }
  .cta-box { background:rgba(232,97,74,0.18); border-left:4px solid #E8614A; padding:${dims.gap*0.7|0}px ${dims.gap}px; max-width:55%; }
  .cta-text { font-size:${dims.cta}px; font-weight:600; color:rgba(248,246,241,0.9); }
</style>
</head><body>
  <div class="bg"></div><div class="overlay-side"></div><div class="overlay-full"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <span class="tag">${data.tagLabel}</span>
    <div class="divider"></div>
    <h1>${data.headlineHTML}</h1>
    <p class="body">${data.body}</p>
    <div class="cta-box"><p class="cta-text">${data.cta}</p></div>
  </div>
</body></html>`,

  // Template C: imagem centralizada com texto em cima E embaixo (mais impacto visual)
  frame_center: (data, bgUrl, dims) => `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:${dims.w}px; height:${dims.h}px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:${dims.h*0.18|0}px ${dims.p*0.5|0}px; border-radius:24px; background-image:url('${bgUrl}'); background-size:cover; background-position:center; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,1) 0%, rgba(13,16,32,0) 22%, rgba(13,16,32,0) 70%, rgba(13,16,32,1) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; padding:${dims.p}px; }
  .handle { position:absolute; top:${dims.top}px; right:${dims.p}px; font-size:${dims.sm}px; color:rgba(248,246,241,0.55); }
  .top-section { padding-top:${dims.gap*0.5|0}px; }
  .tag { display:inline-block; background:${data.tagColor||'#E8614A'}; color:#F8F6F1; font-size:${dims.tag}px; font-weight:700; padding:8px 22px; border-radius:100px; text-transform:uppercase; letter-spacing:1.5px; }
  .bottom-section { margin-top:auto; }
  h1 { font-size:${dims.h1}px; font-weight:900; color:#F8F6F1; line-height:1.02; margin-bottom:${dims.gap*0.8|0}px; }
  .accent { color:${data.accentColor||'#E8614A'}; }
  .body { font-size:${dims.body}px; color:rgba(248,246,241,0.8); line-height:1.55; margin-bottom:${dims.gap}px; }
  .cta-box { background:linear-gradient(135deg, #E8614A, #c94a2e); border-radius:12px; padding:${dims.gap*0.7|0}px ${dims.gap}px; }
  .cta-text { font-size:${dims.cta}px; font-weight:700; color:#fff; }
</style>
</head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <div class="top-section"><span class="tag">${data.tagLabel}</span></div>
    <div class="bottom-section">
      <h1>${data.headlineHTML}</h1>
      <p class="body">${data.body}</p>
      <div class="cta-box"><p class="cta-text">${data.cta}</p></div>
    </div>
  </div>
</body></html>`
};

async function chooseAndCustomizeTemplate(postData, bgImagePath, format = 'post') {
  const client = getClient();
  const bgUrl = imgToDataUrl(bgImagePath);

  const isReel = format === 'reel';
  const dims = isReel
    ? { w: 1080, h: 1920, p: 80, top: 60, gap: 36, h1: 92, body: 38, cta: 30, tag: 24, sm: 30 }
    : { w: 1080, h: 1440, p: 80, top: 52, gap: 28, h1: 76, body: 34, cta: 28, tag: 22, sm: 26 };

  const tagLabels = {
    motivacional: 'MOTIVAÇÃO', educativo: 'EDUCATIVO', cientifico: 'CIÊNCIA',
    mitos: 'MITOS', dica: 'DICA RÁPIDA', treino: 'TREINO', nutricao: 'NUTRIÇÃO'
  };

  // Pede ao Claude para escolher o template e customizar cores
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Você é um designer de Instagram fitness. Para o post abaixo, escolha o melhor template e customizações.

POST:
- Tipo: ${postData.type}
- Headline: ${postData.headline}
- Corpo: ${postData.body}

TEMPLATES DISPONÍVEIS:
- "bottom_text": clássico, texto embaixo, imagem domina — bom para poses impactantes
- "split_left": texto à esquerda, imagem à direita — bom para posts educativos/científicos
- "frame_center": imagem emoldurada no centro, texto em cima e embaixo — bom para posts motivacionais

CORES DISPONÍVEIS para tagColor e accentColor (hex):
- Coral padrão: #E8614A
- Verde fitness: #2ECC71
- Roxo premium: #9B59B6
- Azul energia: #3498DB
- Dourado: #F1C40F

Responda SOMENTE com JSON válido neste formato exato:
{"template":"bottom_text","tagColor":"#E8614A","accentColor":"#E8614A","reason":"motivo em 5 palavras"}`
    }]
  });

  let choice = { template: 'bottom_text', tagColor: '#E8614A', accentColor: '#E8614A' };
  try {
    const text = response.content[0].text.trim();
    const json = text.match(/\{[\s\S]*\}/);
    if (json) choice = { ...choice, ...JSON.parse(json[0]) };
  } catch { /* usa padrão */ }

  // Monta os dados para o template escolhido
  const headlineHTML = postData.accent
    ? postData.headline.replace(new RegExp(`(${postData.accent})`, 'i'), `<span class="accent">$1</span>`)
    : postData.headline;

  const templateData = {
    tagLabel: tagLabels[postData.type] || postData.type?.toUpperCase() || 'FITNESS',
    tagColor: choice.tagColor,
    accentColor: choice.accentColor,
    headlineHTML,
    body: postData.body,
    cta: postData.cta || ''
  };

  const templateFn = TEMPLATE_VARIANTS[choice.template] || TEMPLATE_VARIANTS.bottom_text;
  return { html: templateFn(templateData, bgUrl, dims), choice };
}

// ─── ABORDAGEM 3 — CLAUDE REFINA HTML EXISTENTE ───────────────────────────────
// Gera o HTML base normalmente, depois Claude faz ajustes finos:
// - Aumenta título se o texto for curto
// - Ajusta opacidade do overlay se a imagem for mais clara
// - Reposiciona elementos para melhor equilíbrio visual

async function refineHTML(baseHTML, postData, refinementHints = '') {
  const client = getClient();

  const isLongText = (postData.body || '').length > 120;
  const isShortHeadline = (postData.headline || '').split(' ').length < 4;

  // Só chama a API se houver algo que realmente precisa de refinamento
  if (!isLongText && !isShortHeadline && postData.type !== 'cientifico') {
    return baseHTML;
  }

  // Remove a imagem base64 do HTML antes de enviar ao Claude (evita estouro de tokens)
  // Salva a data URL para reinserir depois
  const bgMatch = baseHTML.match(/url\('(data:image\/[^']+)'\)/);
  const bgDataUrl = bgMatch ? bgMatch[1] : null;
  const htmlSemImagem = bgDataUrl
    ? baseHTML.replace(bgDataUrl, '__BG_URL__')
    : baseHTML;

  const hints = refinementHints || `
- Se o headline for curto (menos de 4 palavras), aumente o font-size do h1 em 15-20%
- Se o corpo do texto for longo (mais de 120 chars), reduza o font-size do .body em 10%
- Se o tipo for "cientifico", adicione um ícone 🔬 antes do headline
- Se o tipo for "motivacional", aumente o contrast do overlay para mais impacto
- Mantenha __BG_URL__ intacto no CSS — não altere esse valor
- Faça apenas ajustes no CSS e no texto, não mude a estrutura HTML`.trim();

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 4096,
    messages: [{
      role: 'user',
      content: `Você é um designer front-end. Faça ajustes finos no HTML abaixo seguindo as instruções.

INSTRUÇÕES DE REFINAMENTO:
${hints}

DADOS DO POST:
- Tipo: ${postData.type}
- Headline (${(postData.headline||'').split(' ').length} palavras): ${postData.headline}
- Corpo (${(postData.body||'').length} chars): ${postData.body}

HTML PARA REFINAR:
${htmlSemImagem}

IMPORTANTE: Retorne APENAS o HTML completo refinado, sem explicações nem markdown. Mantenha __BG_URL__ exatamente como está.`
    }]
  });

  let refined = response.content[0].text.trim();
  if (!refined.startsWith('<!DOCTYPE') && !refined.startsWith('<html')) {
    const start = refined.indexOf('<!DOCTYPE');
    if (start > -1) refined = refined.substring(start);
    else return baseHTML;
  }

  // Reinsere a imagem real
  if (bgDataUrl) refined = refined.replace(/__BG_URL__/g, bgDataUrl);
  return refined;
}

// ─── PIPELINE COMPLETO (usa as 3 abordagens em sequência) ────────────────────
// Para cada post, escolhe a melhor estratégia baseada no tipo:
// - Posts científicos/educativos: Abordagem 2 (template escolhido pelo Claude)
// - Posts motivacionais: Abordagem 1 (HTML gerado do zero para máximo impacto)
// - Todos passam pela Abordagem 3 (refinamento final)

async function generateSmartHTML(postData, bgImagePath, format = 'post') {
  const useFullGeneration = postData.type === 'motivacional';

  let html;
  let strategy;

  if (useFullGeneration) {
    // Abordagem 1: HTML completo gerado pelo Claude
    strategy = 'abordagem-1 (HTML completo)';
    html = await generateFullHTML(postData, bgImagePath, format);
  } else {
    // Abordagem 2: Claude escolhe template + customiza
    const result = await chooseAndCustomizeTemplate(postData, bgImagePath, format);
    strategy = `abordagem-2 (template: ${result.choice.template})`;
    html = result.html;
  }

  // Abordagem 3: refinamento final em todos os casos
  html = await refineHTML(html, postData);

  return { html, strategy };
}

module.exports = {
  generateFullHTML,        // Abordagem 1
  chooseAndCustomizeTemplate, // Abordagem 2
  refineHTML,              // Abordagem 3
  generateSmartHTML        // Pipeline completo (1+2+3)
};
