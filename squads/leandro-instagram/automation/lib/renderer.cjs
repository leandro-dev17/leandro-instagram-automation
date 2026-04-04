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

// ─── STORY POST (1080x1920) — imagem no topo, painel de texto embaixo ─────────

function storyPost(post, bgPath) {
  const bgUrl    = imgToDataUrl(bgPath);
  const tagLabel = TYPE_LABELS[post.type] || (post.type || 'fitness').toUpperCase();
  const headlineHTML = buildHeadlineHTML(post.headline, post.accent);

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700;900&display=swap');
  * { margin:0; padding:0; box-sizing:border-box; }
  body { width:1080px; height:1920px; font-family:'Inter',sans-serif; overflow:hidden; background:#0D1020; display:flex; flex-direction:column; }

  /* Imagem ocupa 58% do topo — sem texto em cima */
  .photo {
    width:100%; height:58%;
    background-image:url('${bgUrl}');
    background-size:cover;
    background-position:center top;
    position:relative;
    flex-shrink:0;
  }
  .photo-handle {
    position:absolute; top:52px; left:56px;
    font-size:30px; font-weight:600; color:rgba(255,255,255,0.88);
    background:rgba(0,0,0,0.32); padding:10px 24px; border-radius:100px;
    letter-spacing:0.5px;
  }
  .photo-gradient {
    position:absolute; bottom:0; left:0; right:0; height:180px;
    background:linear-gradient(to bottom, transparent, #0D1020);
  }

  /* Painel de texto — 42% embaixo, fundo escuro sólido */
  .panel {
    flex:1; background:#0D1020;
    display:flex; flex-direction:column;
    justify-content:center;
    padding:56px 72px 64px;
    gap:28px;
  }
  .tag {
    display:inline-block; background:#E8614A; color:#fff;
    font-size:24px; font-weight:700; padding:10px 28px;
    border-radius:100px; text-transform:uppercase; letter-spacing:2px;
    align-self:flex-start;
  }
  h1 {
    font-size:72px; font-weight:900; color:#F8F6F1;
    line-height:1.06; letter-spacing:-1px;
  }
  .body {
    font-size:34px; font-weight:400; color:rgba(248,246,241,0.80);
    line-height:1.55;
  }
  .cta {
    background:#E8614A; border-radius:16px;
    padding:28px 40px; text-align:center;
    font-size:30px; font-weight:700; color:#fff;
    letter-spacing:0.3px; margin-top:8px;
  }
</style></head><body>
  <div class="photo">
    <div class="photo-handle">@leandro_personall</div>
    <div class="photo-gradient"></div>
  </div>
  <div class="panel">
    <span class="tag">${tagLabel}</span>
    <h1>${headlineHTML}</h1>
    <p class="body">${escapeHtml(post.body || '')}</p>
    <div class="cta">${escapeHtml(post.cta || '💬 Comenta abaixo!')}</div>
  </div>
</body></html>`;
}

// ─── RENDERIZADOR PLAYWRIGHT ───────────────────────────────────────────────────

async function renderHTML(htmlContent, outputPath, width = 1080, height = 1440) {
  const tmpFile = path.join(os.tmpdir(), `bionexus_${Date.now()}.html`);
  fs.writeFileSync(tmpFile, htmlContent, 'utf8');

  // Tenta playwright npm (GitHub Actions / instalação local)
  // Cai de volta para Pinokio no Windows se não encontrar
  let playwright;
  try {
    playwright = require('playwright');
  } catch {
    playwright = require('C:/pinokio/bin/playwright/node_modules/playwright');
  }
  const executablePath = process.platform === 'win32' && !require('fs').existsSync(
    require('path').join(require('os').homedir(), '.cache', 'ms-playwright')
  ) ? 'C:/Users/lelus/AppData/Local/ms-playwright/chromium-1208/chrome-win64/chrome.exe' : undefined;

  const browser = await playwright.chromium.launch({
    executablePath,
    headless: true
  });
  const page = await browser.newPage();
  await page.setViewportSize({ width, height });
  await page.goto('file:///' + tmpFile.replace(/\\/g, '/'), { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: outputPath, fullPage: false, timeout: 60000 });
  await browser.close();

  try { fs.unlinkSync(tmpFile); } catch {}
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

module.exports = { reelPost, recipeDicaReel, singlePost, storyPost, renderHTML, reelSlide1Hook, reelSlide2Dev, reelSlide3Tip, reelSlide4CTA, postCarouselSlide2, postCarouselSlide3 };
