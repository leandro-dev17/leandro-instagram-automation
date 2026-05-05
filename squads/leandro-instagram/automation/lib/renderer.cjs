/**
 * renderer.cjs — Renderiza HTML para PNG usando Playwright/Chromium
 * Também contém templates HTML de fallback para reels e posts.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');




// ─── UTILITÁRIOS ──────────────────────────────────────────────────────────────

function imgToDataUrl(imgPath) {
  const data = fs.readFileSync(imgPath);
  const ext  = path.extname(imgPath).replace('.', '') || 'png';
  return `data:image/${ext};base64,${data.toString('base64')}`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildHeadlineHTML(headline, accent, accentColor = '#E8614A') {
  if (!accent || !headline) return escapeHtml(headline || '');
  return escapeHtml(headline).replace(
    new RegExp(`(${escapeHtml(accent)})`, 'i'),
    `<span style="color:${accentColor}">$1</span>`
  );
}

const TYPE_LABELS = {
  motivacional: 'MOTIVAÇÃO', educativo: 'EDUCATIVO', cientifico: 'CIÊNCIA',
  mitos: 'MITOS', dica: 'DICA RÁPIDA', treino: 'TREINO', nutricao: 'NUTRIÇÃO',
  receita: 'RECEITA', dica_receita: 'DICA'
};

// ─── TEMPLATE: REEL (9:16 — 1080×1920) ───────────────────────────────────────

function reelPost(reel, bgPath) {
  const bgUrl        = imgToDataUrl(bgPath);
  const headlineHTML = buildHeadlineHTML(reel.headline, reel.accent);
  const tagLabel     = TYPE_LABELS[reel.type] || (reel.type || 'fitness').toUpperCase();

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.05) 0%, rgba(13,16,32,0.15) 40%, rgba(13,16,32,0.88) 65%, rgba(13,16,32,0.98) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; justify-content:flex-end; padding:80px; }
  .handle { position:absolute; top:60px; right:80px; font-size:30px; font-weight:400; color:rgba(248,246,241,0.65); letter-spacing:0.5px; }
  .tag { display:inline-block; background:#E8614A; color:#fff; font-size:24px; font-weight:700; padding:10px 28px; border-radius:100px; text-transform:uppercase; letter-spacing:2px; margin-bottom:36px; align-self:flex-start; }
  h1 { font-size:92px; font-weight:900; color:#F8F6F1; line-height:1.02; margin-bottom:36px; }
  .body { font-size:38px; font-weight:400; color:rgba(248,246,241,0.82); line-height:1.55; margin-bottom:44px; }
  .cta-box { background:rgba(248,246,241,0.1); border:1.5px solid rgba(248,246,241,0.18); border-radius:12px; padding:28px 36px; }
  .cta-text { font-size:30px; font-weight:600; color:rgba(248,246,241,0.88); }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <span class="tag">${tagLabel}</span>
    <h1>${headlineHTML}</h1>
    <p class="body">${escapeHtml(reel.body || '')}</p>
    <div class="cta-box"><p class="cta-text">${escapeHtml(reel.cta || '')}</p></div>
  </div>
</body></html>`;
}

// ─── TEMPLATE: REEL DICA DO PERSONAL (9:16) ──────────────────────────────────

function recipeDicaReel(dica, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.7) 0%, rgba(13,16,32,0.3) 30%, rgba(13,16,32,0.3) 55%, rgba(13,16,32,0.95) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; padding:80px; }
  .handle { position:absolute; top:60px; right:80px; font-size:28px; color:rgba(248,246,241,0.65); }
  .top { }
  .tag { display:inline-block; background:#2ECC71; color:#0D1020; font-size:24px; font-weight:700; padding:10px 28px; border-radius:100px; text-transform:uppercase; letter-spacing:2px; margin-bottom:20px; }
  .title { font-size:80px; font-weight:900; color:#F8F6F1; line-height:1.05; max-width:85%; }
  .bottom { margin-top:auto; }
  .category { font-size:28px; color:rgba(248,246,241,0.6); font-weight:500; margin-bottom:24px; text-transform:uppercase; letter-spacing:1.5px; }
  .caption { font-size:36px; color:rgba(248,246,241,0.88); line-height:1.5; }
  .cta-box { margin-top:36px; background:rgba(46,204,113,0.18); border-left:5px solid #2ECC71; padding:24px 32px; }
  .cta-text { font-size:30px; font-weight:600; color:rgba(248,246,241,0.9); }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <div class="top">
      <span class="tag">DICA DO PERSONAL</span>
      <h1 class="title">${escapeHtml(dica.title || '')}</h1>
    </div>
    <div class="bottom">
      <p class="category">${escapeHtml(dica.category || 'Nutrição')}</p>
      <p class="caption">${escapeHtml((dica.caption || '').slice(0, 200))}</p>
      <div class="cta-box"><p class="cta-text">💬 Salva essa dica!</p></div>
    </div>
  </div>
</body></html>`;
}

// ─── TEMPLATE: POST ÚNICO (4:3 — 1080×1440) ──────────────────────────────────

function singlePost(post, bgPath) {
  const bgUrl        = imgToDataUrl(bgPath);
  const headlineHTML = buildHeadlineHTML(post.headline, post.accent);
  const tagLabel     = TYPE_LABELS[post.type] || (post.type || 'fitness').toUpperCase();

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1440px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.05) 0%, rgba(13,16,32,0.2) 45%, rgba(13,16,32,0.88) 68%, rgba(13,16,32,0.98) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; justify-content:flex-end; padding:80px; }
  .handle { position:absolute; top:52px; right:80px; font-size:26px; font-weight:400; color:rgba(248,246,241,0.65); }
  .tag { display:inline-block; background:#E8614A; color:#fff; font-size:22px; font-weight:700; padding:8px 24px; border-radius:100px; text-transform:uppercase; letter-spacing:2px; margin-bottom:28px; align-self:flex-start; }
  h1 { font-size:76px; font-weight:900; color:#F8F6F1; line-height:1.04; margin-bottom:28px; }
  .body { font-size:34px; font-weight:400; color:rgba(248,246,241,0.82); line-height:1.55; margin-bottom:34px; }
  .cta-box { background:rgba(248,246,241,0.1); border:1.5px solid rgba(248,246,241,0.18); border-radius:12px; padding:22px 32px; }
  .cta-text { font-size:28px; font-weight:600; color:rgba(248,246,241,0.88); }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <span class="tag">${tagLabel}</span>
    <h1>${headlineHTML}</h1>
    <p class="body">${escapeHtml(post.body || '')}</p>
    <div class="cta-box"><p class="cta-text">${escapeHtml(post.cta || '')}</p></div>
  </div>
</body></html>`;
}

// ─── STORY POST (1080x1920) — mesmo padrão visual do reel slide 1 ─────────────

function storyPost(post, bgPath) {
  const bgUrl    = imgToDataUrl(bgPath);
  const tagLabel = TYPE_LABELS[post.type] || (post.type || 'fitness').toUpperCase();
  const hook     = escapeHtml(post.hook    || post.headline || '');
  const subhook  = escapeHtml(post.subhook || '');
  const points   = Array.isArray(post.points) ? post.points : [];
  const cta      = escapeHtml(post.cta     || '💬 Comenta abaixo!');

  const pointsHTML = points.map(p => `
    <div class="point">
      <div class="dot"></div>
      <div class="pt">${escapeHtml(p)}</div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }

  /* Imagem full bleed — modelo visível */
  .bg {
    position:absolute; inset:0;
    background-image:url('${bgUrl}');
    background-size:cover; background-position:center top;
  }

  /* Overlay: topo leve (modelo aparece), pesado só na parte inferior onde fica o texto */
  .overlay {
    position:absolute; inset:0;
    background: linear-gradient(
      to bottom,
      rgba(13,16,32,0.30) 0%,
      rgba(13,16,32,0.10) 25%,
      rgba(13,16,32,0.15) 45%,
      rgba(13,16,32,0.82) 65%,
      rgba(13,16,32,0.97) 100%
    );
  }

  /* Handle topo direito — abaixo da zona do Instagram (~220px) */
  .handle {
    position:absolute; top:230px; right:72px;
    font-size:28px; font-weight:600; color:rgba(248,246,241,0.70);
    letter-spacing:0.3px;
  }

  /* Tag topo esquerdo — abaixo da zona do Instagram (~220px) */
  .tag {
    position:absolute; top:220px; left:72px;
    background:#E8614A; color:#fff;
    font-size:22px; font-weight:800; padding:10px 28px;
    border-radius:100px; text-transform:uppercase; letter-spacing:2px;
  }

  /* Conteúdo: acima da barra de ações do Instagram (~220px do rodapé) */
  .content {
    position:absolute; bottom:220px; left:0; right:0;
    padding:0 80px;
    display:flex; flex-direction:column; gap:0;
  }

  .hook {
    font-size:86px; font-weight:900; color:#F8F6F1;
    line-height:1.04; letter-spacing:-1px;
    margin-bottom:24px;
  }

  .subhook {
    font-size:36px; font-weight:400; color:rgba(248,246,241,0.80);
    line-height:1.5; margin-bottom:40px;
  }

  .points { display:flex; flex-direction:column; gap:20px; margin-bottom:44px; }
  .point  { display:flex; align-items:center; gap:22px; }
  .dot    { width:14px; height:14px; background:#E8614A; border-radius:50%; flex-shrink:0; }
  .pt     { font-size:36px; font-weight:500; color:rgba(248,246,241,0.88); line-height:1.45; }

  .cta {
    background:#E8614A; border-radius:18px;
    padding:30px 48px; text-align:center;
    font-size:34px; font-weight:800; color:#fff;
    letter-spacing:0.3px;
  }
</style></head><body>
  <div class="bg"></div>
  <div class="overlay"></div>
  <div class="handle">@leandro_personall</div>
  <div class="tag">${tagLabel}</div>
  <div class="content">
    <div class="hook">${hook}</div>
    ${subhook ? `<div class="subhook">${subhook}</div>` : ''}
    ${points.length > 0 ? `<div class="points">${pointsHTML}</div>` : ''}
    <div class="cta">${cta}</div>
  </div>
</body></html>`;
}

// ─── RENDERIZADOR PLAYWRIGHT ───────────────────────────────────────────────────

async function _launchBrowser() {
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    try {
      playwright = require('C:/pinokio/bin/playwright/node_modules/playwright');
    } catch {
      throw new Error('Playwright não encontrado. Execute: npm install playwright');
    }
  }

  let executablePath;
  const msPlaywrightCache = path.join(os.homedir(), '.cache', 'ms-playwright');
  if (process.platform === 'win32' && !fs.existsSync(msPlaywrightCache)) {
    const chromiumBase = path.join(process.env.LOCALAPPDATA || '', 'ms-playwright');
    if (fs.existsSync(chromiumBase)) {
      const chromiumDirs = fs.readdirSync(chromiumBase).filter(d => d.startsWith('chromium-'));
      if (chromiumDirs.length > 0) {
        executablePath = path.join(chromiumBase, chromiumDirs[0], 'chrome-win64', 'chrome.exe');
      }
    }
  }

  return playwright.chromium.launch({ executablePath, headless: true });
}

async function _screenshotPage(browser, htmlContent, outputPath, width, height, transparent) {
  const tmpFile = path.join(os.tmpdir(), `bionexus_${Date.now()}_${Math.random().toString(36).slice(2)}.html`);
  fs.writeFileSync(tmpFile, htmlContent, 'utf8');
  const page = await browser.newPage();
  try {
    await page.setViewportSize({ width, height });
    const fileUrl = require('url').pathToFileURL(tmpFile).href;
    await page.goto(fileUrl, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForTimeout(transparent ? 1000 : 2000);
    await page.screenshot({ path: outputPath, fullPage: false, omitBackground: transparent, timeout: 120000 });
  } finally {
    await page.close();
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

async function renderHTML(htmlContent, outputPath, width = 1080, height = 1440) {
  const browser = await _launchBrowser();
  try {
    await _screenshotPage(browser, htmlContent, outputPath, width, height, false);
  } finally {
    await browser.close();
  }
}

/**
 * Render HTML to a transparent PNG (RGBA) — suitable for video overlays.
 */
async function renderOverlay(htmlContent, outputPath, width = 1080, height = 1920) {
  const browser = await _launchBrowser();
  try {
    await _screenshotPage(browser, htmlContent, outputPath, width, height, true);
  } finally {
    await browser.close();
  }
}

/**
 * Render multiple HTML overlays in a single browser session (more efficient).
 * @param {Array<{html: string, outputPath: string}>} items
 */
async function renderOverlayBatch(items, width = 1080, height = 1920) {
  const browser = await _launchBrowser();
  try {
    for (const item of items) {
      await _screenshotPage(browser, item.html, item.outputPath, width, height, true);
    }
  } finally {
    await browser.close();
  }
}

// ─── TEMPLATES: CARROSSEL DE POST (4:5 — 1080×1350) ──────────────────────────
// Slide 2: Detalhes/pontos principais do tema
function postCarouselSlide2(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1350px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.15) 0%, rgba(13,16,32,0.88) 60%, rgba(13,16,32,0.98) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; justify-content:flex-end; padding:72px; }
  .handle { position:absolute; top:50px; right:72px; font-size:28px; color:rgba(248,246,241,0.65); }
  .tag { display:inline-block; background:#E8614A; color:#fff; font-size:22px; font-weight:700; padding:8px 24px; border-radius:100px; text-transform:uppercase; letter-spacing:2px; margin-bottom:28px; align-self:flex-start; }
  h2 { font-size:72px; font-weight:900; color:#F8F6F1; line-height:1.05; margin-bottom:32px; }
  .points { display:flex; flex-direction:column; gap:20px; }
  .point { display:flex; align-items:flex-start; gap:20px; }
  .dot { width:12px; height:12px; background:#E8614A; border-radius:50%; margin-top:14px; flex-shrink:0; }
  .point-text { font-size:36px; color:rgba(248,246,241,0.85); line-height:1.5; }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <span class="tag">Saiba mais</span>
    <h2>${escapeHtml(data.headline)}</h2>
    <div class="points">
      ${(data.points || []).map(p => `<div class="point"><div class="dot"></div><p class="point-text">${escapeHtml(p)}</p></div>`).join('')}
    </div>
  </div>
</body></html>`;
}

// Slide 3: CTA — salvar e seguir
function postCarouselSlide3(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1350px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.65) 0%, rgba(13,16,32,0.88) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:80px; text-align:center; }
  .handle { position:absolute; top:50px; right:72px; font-size:28px; color:rgba(248,246,241,0.65); }
  h2 { font-size:82px; font-weight:900; color:#F8F6F1; line-height:1.05; margin-bottom:36px; }
  .sub { font-size:38px; color:rgba(248,246,241,0.80); line-height:1.5; margin-bottom:60px; }
  .btn { background:#E8614A; color:#fff; font-size:36px; font-weight:900; padding:32px 72px; border-radius:100px; margin-bottom:28px; }
  .btn2 { border:2px solid rgba(248,246,241,0.4); color:rgba(248,246,241,0.85); font-size:32px; font-weight:600; padding:24px 60px; border-radius:100px; }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <h2>${escapeHtml(data.headline)}</h2>
    <p class="sub">${escapeHtml(data.body)}</p>
    <div class="btn">💾 Salva esse post!</div>
    <div class="btn2">Segue @leandro_personall</div>
  </div>
</body></html>`;
}

// ─── TEMPLATES: 4 SLIDES DE REEL ─────────────────────────────────────────────
// Slide 1 — Gancho/Pergunta: fundo escuro dramático, pergunta grande centralizada

function reelSlide1Hook(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.55) 0%, rgba(13,16,32,0.75) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 80px; text-align:center; }
  .handle { position:absolute; top:60px; right:80px; font-size:30px; color:rgba(248,246,241,0.65); }
  .slide-num { font-size:26px; font-weight:700; color:#E8614A; letter-spacing:3px; text-transform:uppercase; margin-bottom:48px; }
  h1 { font-size:100px; font-weight:900; color:#F8F6F1; line-height:1.0; margin-bottom:48px; }
  .body { font-size:42px; font-weight:400; color:rgba(248,246,241,0.80); line-height:1.5; }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <div class="slide-num">1 de 4</div>
    <h1>${escapeHtml(data.headline)}</h1>
    <p class="body">${escapeHtml(data.body)}</p>
  </div>
</body></html>`;
}

// Slide 2 — Desenvolvimento: fundo com imagem, texto explicativo
function reelSlide2Dev(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.1) 0%, rgba(13,16,32,0.2) 45%, rgba(13,16,32,0.92) 68%, rgba(13,16,32,0.98) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; justify-content:flex-end; padding:80px; }
  .handle { position:absolute; top:60px; right:80px; font-size:30px; color:rgba(248,246,241,0.65); }
  .slide-num { font-size:26px; font-weight:700; color:#E8614A; letter-spacing:3px; text-transform:uppercase; margin-bottom:28px; }
  h1 { font-size:86px; font-weight:900; color:#F8F6F1; line-height:1.05; margin-bottom:36px; }
  .body { font-size:40px; font-weight:400; color:rgba(248,246,241,0.82); line-height:1.55; }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <div class="slide-num">2 de 4</div>
    <h1>${escapeHtml(data.headline)}</h1>
    <p class="body">${escapeHtml(data.body)}</p>
  </div>
</body></html>`;
}

// Slide 3 — Dica principal: destaque visual em card laranja
function reelSlide3Tip(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.1) 0%, rgba(13,16,32,0.2) 45%, rgba(13,16,32,0.92) 65%, rgba(13,16,32,0.98) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; justify-content:flex-end; padding:80px; }
  .handle { position:absolute; top:60px; right:80px; font-size:30px; color:rgba(248,246,241,0.65); }
  .slide-num { font-size:26px; font-weight:700; color:#E8614A; letter-spacing:3px; text-transform:uppercase; margin-bottom:28px; }
  h1 { font-size:80px; font-weight:900; color:#E8614A; line-height:1.05; margin-bottom:32px; }
  .tip-card { background:rgba(232,97,74,0.15); border:2px solid #E8614A; border-radius:20px; padding:44px 48px; }
  .tip-text { font-size:44px; font-weight:700; color:#F8F6F1; line-height:1.45; }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <div class="slide-num">3 de 4</div>
    <h1>${escapeHtml(data.headline)}</h1>
    <div class="tip-card"><p class="tip-text">${escapeHtml(data.body)}</p></div>
  </div>
</body></html>`;
}

// Slide 4 — CTA: fundo escuro, botão de seguir em destaque
function reelSlide4CTA(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }
  .bg { position:absolute; inset:0; background-image:url('${bgUrl}'); background-size:cover; background-position:center top; }
  .overlay { position:absolute; inset:0; background:linear-gradient(to bottom, rgba(13,16,32,0.6) 0%, rgba(13,16,32,0.85) 100%); }
  .content { position:relative; z-index:10; width:100%; height:100%; display:flex; flex-direction:column; align-items:center; justify-content:center; padding:100px 80px; text-align:center; }
  .handle { position:absolute; top:60px; right:80px; font-size:30px; color:rgba(248,246,241,0.65); }
  .slide-num { font-size:26px; font-weight:700; color:#E8614A; letter-spacing:3px; text-transform:uppercase; margin-bottom:48px; }
  h1 { font-size:90px; font-weight:900; color:#F8F6F1; line-height:1.05; margin-bottom:40px; }
  .body { font-size:40px; color:rgba(248,246,241,0.80); line-height:1.5; margin-bottom:64px; }
  .btn { background:#E8614A; color:#fff; font-size:40px; font-weight:900; padding:36px 80px; border-radius:100px; letter-spacing:1px; }
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="content">
    <span class="handle">@leandro_personall</span>
    <div class="slide-num">4 de 4</div>
    <h1>${escapeHtml(data.headline)}</h1>
    <p class="body">${escapeHtml(data.body)}</p>
    <div class="btn">Seguir @leandro_personall</div>
  </div>
</body></html>`;
}

// ─── STORY MODELO B — Cards flutuantes com fundo colorido vibrante ────────────

function storyPostB(post, bgPath) {
  const bgUrl   = imgToDataUrl(bgPath);
  const tagLabel = TYPE_LABELS[post.type] || (post.type || 'fitness').toUpperCase();
  const hook    = escapeHtml(post.hook    || post.headline || '');
  const subhook = escapeHtml(post.subhook || '');
  const points  = Array.isArray(post.points) ? post.points : [];
  const cta     = escapeHtml(post.cta     || '💬 Comenta abaixo!');

  const pointsHTML = points.map((p, i) => `
    <div class="card">
      <div class="card-icon">${['🔥','💡','⚡'][i] || '✅'}</div>
      <div class="card-text">${escapeHtml(p)}</div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#0D1020; }

  .bg {
    position:absolute; inset:0;
    background-image:url('${bgUrl}');
    background-size:cover; background-position:center;
    filter: brightness(0.35) saturate(1.2);
  }

  /* Faixa de cor vibrante no topo */
  .top-accent {
    position:absolute; top:0; left:0; right:0; height:12px;
    background: linear-gradient(90deg, #E8614A, #FF9F43, #E8614A);
  }

  .wrap {
    position:absolute; inset:0;
    display:flex; flex-direction:column;
    padding:72px 64px 80px;
    gap:0;
  }

  /* Handle */
  .handle {
    font-size:28px; font-weight:700; color:rgba(255,255,255,0.7);
    letter-spacing:0.5px; margin-bottom:40px;
  }

  /* Tag pill */
  .tag {
    display:inline-block; background:transparent;
    border:2px solid #E8614A; color:#E8614A;
    font-size:22px; font-weight:800; padding:10px 28px;
    border-radius:100px; text-transform:uppercase; letter-spacing:2px;
    align-self:flex-start; margin-bottom:36px;
  }

  /* Hook */
  .hook {
    font-size:80px; font-weight:900; color:#FFFFFF;
    line-height:1.04; letter-spacing:-1px; margin-bottom:24px;
  }
  .hook em { color:#FF9F43; font-style:normal; }

  .subhook {
    font-size:36px; font-weight:500; color:rgba(255,255,255,0.75);
    line-height:1.45; margin-bottom:56px;
  }

  /* Cards flutuantes */
  .cards { display:flex; flex-direction:column; gap:20px; flex:1; }
  .card {
    background: rgba(255,255,255,0.08);
    border:1px solid rgba(255,255,255,0.12);
    border-left:5px solid #E8614A;
    backdrop-filter:blur(8px);
    border-radius:20px;
    padding:28px 32px;
    display:flex; align-items:center; gap:24px;
  }
  .card-icon { font-size:40px; flex-shrink:0; }
  .card-text { font-size:34px; font-weight:600; color:#F8F6F1; line-height:1.4; }

  /* CTA */
  .cta {
    margin-top:40px;
    background: linear-gradient(135deg, #E8614A, #FF9F43);
    border-radius:20px; padding:34px 48px;
    text-align:center; font-size:34px; font-weight:800; color:#fff;
    letter-spacing:0.5px;
    box-shadow: 0 8px 32px rgba(232,97,74,0.45);
  }
</style></head><body>
  <div class="bg"></div>
  <div class="top-accent"></div>
  <div class="wrap">
    <div class="handle">@leandro_personall</div>
    <div class="tag">${tagLabel}</div>
    <div class="hook">${hook}</div>
    ${subhook ? `<div class="subhook">${subhook}</div>` : ''}
    <div class="cards">${pointsHTML}</div>
    <div class="cta">${cta}</div>
  </div>
</body></html>`;
}

// ─── STORY MODELO C — Split: metade foto, metade conteúdo claro ───────────────

function storyPostC(post, bgPath) {
  const bgUrl   = imgToDataUrl(bgPath);
  const tagLabel = TYPE_LABELS[post.type] || (post.type || 'fitness').toUpperCase();
  const hook    = escapeHtml(post.hook    || post.headline || '');
  const subhook = escapeHtml(post.subhook || '');
  const points  = Array.isArray(post.points) ? post.points : [];
  const cta     = escapeHtml(post.cta     || '💬 Comenta abaixo!');

  const pointsHTML = points.map((p, i) => `
    <div class="point">
      <div class="bullet">${i + 1}</div>
      <div class="pt">${escapeHtml(p)}</div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; display:flex; flex-direction:column; background:#F5F0EB; }

  /* Foto — 52% do topo */
  .photo {
    width:100%; height:52%; position:relative; flex-shrink:0;
    background-image:url('${bgUrl}');
    background-size:cover; background-position:center top;
  }
  .photo-overlay {
    position:absolute; inset:0;
    background:linear-gradient(to bottom, rgba(0,0,0,0.1), rgba(0,0,0,0.4));
  }
  .photo-top {
    position:absolute; top:52px; left:0; right:0;
    padding:0 56px;
    display:flex; align-items:center; justify-content:space-between;
  }
  .handle {
    font-size:28px; font-weight:700; color:#fff;
    background:rgba(0,0,0,0.3); padding:10px 24px; border-radius:100px;
  }
  .tag {
    background:#E8614A; color:#fff;
    font-size:22px; font-weight:800; padding:10px 24px;
    border-radius:100px; text-transform:uppercase; letter-spacing:1.5px;
  }
  /* Hook flutuando na foto */
  .hook-on-photo {
    position:absolute; bottom:0; left:0; right:0;
    padding:0 56px 40px;
  }
  .hook {
    font-size:72px; font-weight:900; color:#fff;
    line-height:1.05; letter-spacing:-1px;
    text-shadow: 0 3px 20px rgba(0,0,0,0.6);
  }

  /* Painel de conteúdo — fundo claro quente */
  .panel {
    flex:1; background:#F5F0EB;
    padding:48px 64px 64px;
    display:flex; flex-direction:column; gap:0;
  }
  .subhook {
    font-size:34px; font-weight:600; color:#92400E;
    line-height:1.4; margin-bottom:40px;
  }
  .points { display:flex; flex-direction:column; gap:22px; flex:1; }
  .point { display:flex; align-items:flex-start; gap:20px; }
  .bullet {
    width:48px; height:48px; border-radius:50%;
    background:#E8614A; color:#fff;
    font-size:24px; font-weight:800;
    display:flex; align-items:center; justify-content:center; flex-shrink:0;
  }
  .pt { font-size:34px; font-weight:500; color:#1C1917; line-height:1.45; padding-top:6px; }

  .cta {
    margin-top:36px;
    background:#1C1917; border-radius:18px;
    padding:30px 44px; text-align:center;
    font-size:32px; font-weight:800; color:#fff;
  }
</style></head><body>
  <div class="photo">
    <div class="photo-overlay"></div>
    <div class="photo-top">
      <div class="handle">@leandro_personall</div>
      <div class="tag">${tagLabel}</div>
    </div>
    <div class="hook-on-photo">
      <div class="hook">${hook}</div>
    </div>
  </div>
  <div class="panel">
    ${subhook ? `<div class="subhook">${subhook}</div>` : ''}
    <div class="points">${pointsHTML}</div>
    <div class="cta">${cta}</div>
  </div>
</body></html>`;
}

// ─── STORY MODELO D — Minimal bold: tipografia enorme, fundo sólido escuro ────

function storyPostD(post, bgPath) {
  const bgUrl   = imgToDataUrl(bgPath);
  const tagLabel = TYPE_LABELS[post.type] || (post.type || 'fitness').toUpperCase();
  const hook    = escapeHtml(post.hook    || post.headline || '');
  const subhook = escapeHtml(post.subhook || '');
  const points  = Array.isArray(post.points) ? post.points : [];
  const cta     = escapeHtml(post.cta     || '💬 Comenta abaixo!');

  const pointsHTML = points.map((p, i) => `
    <div class="point">
      <span class="num">0${i + 1}</span>
      <span class="pt">${escapeHtml(p)}</span>
    </div>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; position:relative; background:#111118; }

  /* Foto pequena — canto superior direito, circular */
  .bg-strip {
    position:absolute; top:0; left:0; right:0; height:680px;
    background-image:url('${bgUrl}');
    background-size:cover; background-position:center top;
    clip-path:polygon(0 0, 100% 0, 100% 75%, 0 100%);
  }
  .bg-overlay {
    position:absolute; top:0; left:0; right:0; height:680px;
    background:linear-gradient(to bottom, rgba(17,17,24,0.2), rgba(17,17,24,0.9));
    clip-path:polygon(0 0, 100% 0, 100% 75%, 0 100%);
  }

  .wrap {
    position:absolute; inset:0;
    display:flex; flex-direction:column;
    padding:64px 72px 80px;
  }

  /* Top */
  .top { display:flex; align-items:center; justify-content:space-between; margin-bottom:auto; }
  .handle { font-size:28px; font-weight:700; color:rgba(255,255,255,0.8); }
  .tag {
    background:rgba(232,97,74,0.15); border:1.5px solid #E8614A;
    color:#E8614A; font-size:22px; font-weight:800;
    padding:10px 24px; border-radius:100px;
    text-transform:uppercase; letter-spacing:2px;
  }

  /* Conteúdo principal — bottom half */
  .main { margin-top:auto; }

  .hook {
    font-size:88px; font-weight:900; color:#fff;
    line-height:1.02; letter-spacing:-2px; margin-bottom:20px;
  }
  .hook em { color:#E8614A; font-style:normal; }
  .subhook {
    font-size:36px; font-weight:500; color:rgba(255,255,255,0.6);
    line-height:1.45; margin-bottom:52px;
    padding-left:4px;
  }

  /* Pontos estilo lista mínima */
  .points { display:flex; flex-direction:column; gap:0; margin-bottom:52px; }
  .point {
    display:flex; align-items:baseline; gap:20px;
    padding:24px 0;
    border-bottom:1px solid rgba(255,255,255,0.08);
  }
  .point:first-child { border-top:1px solid rgba(255,255,255,0.08); }
  .num { font-size:22px; font-weight:800; color:#E8614A; letter-spacing:1px; flex-shrink:0; width:44px; }
  .pt  { font-size:36px; font-weight:600; color:#F8F6F1; line-height:1.4; }

  .cta {
    background:#E8614A; border-radius:18px;
    padding:32px 48px; text-align:center;
    font-size:34px; font-weight:800; color:#fff;
  }
</style></head><body>
  <div class="bg-strip"></div>
  <div class="bg-overlay"></div>
  <div class="wrap">
    <div class="top">
      <div class="handle">@leandro_personall</div>
      <div class="tag">${tagLabel}</div>
    </div>
    <div class="main">
      <div class="hook">${hook}</div>
      ${subhook ? `<div class="subhook">${subhook}</div>` : ''}
      <div class="points">${pointsHTML}</div>
      <div class="cta">${cta}</div>
    </div>
  </div>
</body></html>`;
}

// ─── STORY SLIDES NOVO (9:16 — 1080×1920) ─────────────────────────────────────
// 5 slides com a MESMA imagem base, só o texto muda.
// style: 'hook' (slide 1), 'content' (slides 2-4), 'cta' (slide 5)

function storySlide(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  const { slideNum, totalSlides, style, label, headline, body, cta, points } = data;
  const h = (s) => escapeHtml(s || '');

  const dots = Array.from({ length: totalSlides }, (_, i) =>
    `<span class="dot${i + 1 === slideNum ? ' active' : ''}"></span>`
  ).join('');

  if (style === 'hook') {
    // Slide 1 — GANCHO: overlay forte, texto centralizado, modelo visível no topo
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1920px;font-family:'Inter',sans-serif;overflow:hidden;position:relative;background:#0D1020;}
  .bg{position:absolute;inset:0;background-image:url('${bgUrl}');background-size:cover;background-position:center top;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(13,16,32,0.08) 0%,rgba(13,16,32,0.15) 35%,rgba(13,16,32,0.92) 62%,rgba(13,16,32,0.99) 100%);}
  .header{position:absolute;top:230px;left:0;right:0;padding:0 72px;display:flex;align-items:center;justify-content:space-between;}
  .tag{background:#E8614A;color:#fff;font-size:22px;font-weight:800;padding:10px 28px;border-radius:100px;text-transform:uppercase;letter-spacing:2px;}
  .handle{font-size:26px;font-weight:600;color:rgba(248,246,241,0.70);}
  .content{position:absolute;bottom:220px;left:0;right:0;padding:0 80px;}
  .dots{display:flex;gap:12px;margin-bottom:40px;}
  .dot{width:10px;height:10px;background:rgba(248,246,241,0.35);border-radius:50%;}
  .dot.active{background:#E8614A;width:32px;border-radius:10px;}
  h1{font-size:96px;font-weight:900;color:#F8F6F1;line-height:1.02;margin-bottom:32px;letter-spacing:-1px;}
  .sub{font-size:40px;font-weight:400;color:rgba(248,246,241,0.78);line-height:1.5;margin-bottom:48px;}
  .swipe{font-size:28px;font-weight:600;color:rgba(248,246,241,0.55);letter-spacing:1px;}
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="header"><span class="tag">${h(label)}</span><span class="handle">@leandro_personall</span></div>
  <div class="content">
    <div class="dots">${dots}</div>
    <h1>${h(headline)}</h1>
    <p class="sub">${h(body)}</p>
    <p class="swipe">Arraste para ver ›</p>
  </div>
</body></html>`;
  }

  if (style === 'cta') {
    // Slide 5 — CTA URGENTE: botão laranja grande, overlay total
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1920px;font-family:'Inter',sans-serif;overflow:hidden;position:relative;background:#0D1020;}
  .bg{position:absolute;inset:0;background-image:url('${bgUrl}');background-size:cover;background-position:center top;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(13,16,32,0.55) 0%,rgba(13,16,32,0.90) 60%,rgba(13,16,32,0.99) 100%);}
  .header{position:absolute;top:230px;left:0;right:0;padding:0 72px;display:flex;align-items:center;justify-content:space-between;}
  .tag{background:#E8614A;color:#fff;font-size:22px;font-weight:800;padding:10px 28px;border-radius:100px;text-transform:uppercase;letter-spacing:2px;}
  .handle{font-size:26px;font-weight:600;color:rgba(248,246,241,0.70);}
  .content{position:absolute;bottom:220px;left:0;right:0;padding:0 80px;}
  .dots{display:flex;gap:12px;margin-bottom:56px;}
  .dot{width:10px;height:10px;background:rgba(248,246,241,0.35);border-radius:50%;}
  .dot.active{background:#E8614A;width:32px;border-radius:10px;}
  h1{font-size:86px;font-weight:900;color:#F8F6F1;line-height:1.04;margin-bottom:48px;}
  .btn{background:#E8614A;color:#fff;font-size:38px;font-weight:900;padding:36px 60px;border-radius:20px;text-align:center;margin-bottom:28px;line-height:1.3;}
  .btn2{border:2.5px solid rgba(248,246,241,0.35);color:rgba(248,246,241,0.80);font-size:32px;font-weight:600;padding:28px 60px;border-radius:20px;text-align:center;}
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="header"><span class="tag">${h(label)}</span><span class="handle">@leandro_personall</span></div>
  <div class="content">
    <div class="dots">${dots}</div>
    <h1>${h(headline)}</h1>
    <div class="btn">${h(cta)}</div>
    <div class="btn2">Segue @leandro_personall 🔔</div>
  </div>
</body></html>`;
  }

  // Slides 2-4 — CONTEÚDO: modelo visível no topo, texto na base
  const pointsHTML = Array.isArray(points) && points.length > 0
    ? `<div class="points">${points.map(p => `<div class="point"><div class="dot-item"></div><p>${h(p)}</p></div>`).join('')}</div>`
    : `<p class="body">${h(body)}</p>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1920px;font-family:'Inter',sans-serif;overflow:hidden;position:relative;background:#0D1020;}
  .bg{position:absolute;inset:0;background-image:url('${bgUrl}');background-size:cover;background-position:center top;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(13,16,32,0.05) 0%,rgba(13,16,32,0.10) 38%,rgba(13,16,32,0.90) 62%,rgba(13,16,32,0.99) 100%);}
  .header{position:absolute;top:230px;left:0;right:0;padding:0 72px;display:flex;align-items:center;justify-content:space-between;}
  .tag{background:#E8614A;color:#fff;font-size:22px;font-weight:800;padding:10px 28px;border-radius:100px;text-transform:uppercase;letter-spacing:2px;}
  .handle{font-size:26px;font-weight:600;color:rgba(248,246,241,0.70);}
  .content{position:absolute;bottom:200px;left:0;right:0;padding:0 80px;}
  .dots{display:flex;gap:12px;margin-bottom:32px;}
  .dot{width:10px;height:10px;background:rgba(248,246,241,0.35);border-radius:50%;}
  .dot.active{background:#E8614A;width:32px;border-radius:10px;}
  h2{font-size:72px;font-weight:900;color:#F8F6F1;line-height:1.05;margin-bottom:28px;}
  .body{font-size:40px;font-weight:400;color:rgba(248,246,241,0.82);line-height:1.55;}
  .points{display:flex;flex-direction:column;gap:22px;}
  .point{display:flex;align-items:flex-start;gap:20px;}
  .dot-item{width:12px;height:12px;background:#E8614A;border-radius:50%;margin-top:16px;flex-shrink:0;}
  .point p{font-size:38px;color:rgba(248,246,241,0.85);line-height:1.5;}
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="header"><span class="tag">${h(label)}</span><span class="handle">@leandro_personall</span></div>
  <div class="content">
    <div class="dots">${dots}</div>
    <h2>${h(headline)}</h2>
    ${pointsHTML}
  </div>
</body></html>`;
}

// ─── CAROUSEL SLIDES NOVO (4:5 — 1080×1350) ──────────────────────────────────
// 7 slides com a MESMA imagem base, só o texto muda.
// style: 'cover' (slide 1), 'content' (slides 2-6), 'cta' (slide 7)

function carouselSlide(data, bgPath) {
  const bgUrl = imgToDataUrl(bgPath);
  const { slideNum, totalSlides, style, label, headline, body, cta, points } = data;
  const h = (s) => escapeHtml(s || '');

  const counter = `${slideNum} / ${totalSlides}`;

  if (style === 'cover') {
    // Slide 1 — CAPA: hook impactante, "arraste" subtil
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1350px;font-family:'Inter',sans-serif;overflow:hidden;position:relative;background:#0D1020;}
  .bg{position:absolute;inset:0;background-image:url('${bgUrl}');background-size:cover;background-position:center top;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(13,16,32,0.02) 0%,rgba(13,16,32,0.10) 38%,rgba(13,16,32,0.90) 65%,rgba(13,16,32,0.99) 100%);}
  .top{position:absolute;top:50px;left:0;right:0;padding:0 72px;display:flex;align-items:center;justify-content:space-between;}
  .tag{background:#E8614A;color:#fff;font-size:22px;font-weight:800;padding:8px 24px;border-radius:100px;text-transform:uppercase;letter-spacing:2px;}
  .handle{font-size:26px;font-weight:600;color:rgba(248,246,241,0.70);}
  .content{position:absolute;bottom:72px;left:0;right:0;padding:0 72px;}
  h1{font-size:88px;font-weight:900;color:#F8F6F1;line-height:1.03;margin-bottom:28px;letter-spacing:-1px;}
  .sub{font-size:36px;color:rgba(248,246,241,0.75);line-height:1.5;margin-bottom:36px;}
  .swipe{display:flex;align-items:center;gap:16px;font-size:26px;font-weight:700;color:rgba(248,246,241,0.55);letter-spacing:1px;}
  .arrow{font-size:32px;}
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="top"><span class="tag">${h(label)}</span><span class="handle">@leandro_personall</span></div>
  <div class="content">
    <h1>${h(headline)}</h1>
    <p class="sub">${h(body)}</p>
    <div class="swipe"><span>Arraste para ver</span><span class="arrow">›</span></div>
  </div>
</body></html>`;
  }

  if (style === 'cta') {
    // Slide 7 — CTA: dois botões, fundo escuro, centralizado
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1350px;font-family:'Inter',sans-serif;overflow:hidden;position:relative;background:#0D1020;}
  .bg{position:absolute;inset:0;background-image:url('${bgUrl}');background-size:cover;background-position:center top;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(13,16,32,0.60) 0%,rgba(13,16,32,0.92) 55%,rgba(13,16,32,0.99) 100%);}
  .top{position:absolute;top:50px;left:0;right:0;padding:0 72px;display:flex;align-items:center;justify-content:space-between;}
  .tag{background:#E8614A;color:#fff;font-size:22px;font-weight:800;padding:8px 24px;border-radius:100px;text-transform:uppercase;letter-spacing:2px;}
  .counter{font-size:26px;font-weight:600;color:rgba(248,246,241,0.55);}
  .content{position:absolute;bottom:72px;left:0;right:0;padding:0 72px;}
  h2{font-size:76px;font-weight:900;color:#F8F6F1;line-height:1.05;margin-bottom:48px;}
  .btn{background:#E8614A;color:#fff;font-size:36px;font-weight:900;padding:32px 56px;border-radius:18px;text-align:center;margin-bottom:24px;line-height:1.3;}
  .btn2{border:2px solid rgba(248,246,241,0.35);color:rgba(248,246,241,0.80);font-size:30px;font-weight:600;padding:26px 56px;border-radius:18px;text-align:center;}
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="top"><span class="tag">${h(label)}</span><span class="counter">${counter}</span></div>
  <div class="content">
    <h2>${h(headline)}</h2>
    <div class="btn">${h(cta)}</div>
    <div class="btn2">Segue @leandro_personall 🔔</div>
  </div>
</body></html>`;
  }

  // Slides 2-6 — CONTEÚDO: foto visível no topo, seção com label + texto
  const pointsHTML = Array.isArray(points) && points.length > 0
    ? `<div class="points">${points.map(p => `<div class="point"><div class="dot-item"></div><p>${h(p)}</p></div>`).join('')}</div>`
    : `<p class="body">${h(body)}</p>`;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;700;900&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1350px;font-family:'Inter',sans-serif;overflow:hidden;position:relative;background:#0D1020;}
  .bg{position:absolute;inset:0;background-image:url('${bgUrl}');background-size:cover;background-position:center top;}
  .overlay{position:absolute;inset:0;background:linear-gradient(to bottom,rgba(13,16,32,0.05) 0%,rgba(13,16,32,0.15) 35%,rgba(13,16,32,0.92) 58%,rgba(13,16,32,0.99) 100%);}
  .top{position:absolute;top:50px;left:0;right:0;padding:0 72px;display:flex;align-items:center;justify-content:space-between;}
  .tag{background:#E8614A;color:#fff;font-size:22px;font-weight:800;padding:8px 24px;border-radius:100px;text-transform:uppercase;letter-spacing:2px;}
  .counter{font-size:26px;font-weight:600;color:rgba(248,246,241,0.55);}
  .content{position:absolute;bottom:60px;left:0;right:0;padding:0 72px;}
  h2{font-size:68px;font-weight:900;color:#F8F6F1;line-height:1.06;margin-bottom:28px;}
  .body{font-size:38px;font-weight:400;color:rgba(248,246,241,0.82);line-height:1.55;}
  .points{display:flex;flex-direction:column;gap:20px;}
  .point{display:flex;align-items:flex-start;gap:18px;}
  .dot-item{width:12px;height:12px;background:#E8614A;border-radius:50%;margin-top:16px;flex-shrink:0;}
  .point p{font-size:36px;color:rgba(248,246,241,0.85);line-height:1.5;}
</style></head><body>
  <div class="bg"></div><div class="overlay"></div>
  <div class="top"><span class="tag">${h(label)}</span><span class="counter">${counter}</span></div>
  <div class="content">
    <h2>${h(headline)}</h2>
    ${pointsHTML}
  </div>
</body></html>`;
}

module.exports = { reelPost, recipeDicaReel, singlePost, storyPost, storyPostB, storyPostC, storyPostD, renderHTML, renderOverlay, renderOverlayBatch, reelSlide1Hook, reelSlide2Dev, reelSlide3Tip, reelSlide4CTA, postCarouselSlide2, postCarouselSlide3, storySlide, carouselSlide };
