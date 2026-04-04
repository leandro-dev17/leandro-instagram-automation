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

// ─── RENDERIZADOR PLAYWRIGHT ───────────────────────────────────────────────────

async function renderHTML(htmlContent, outputPath, width = 1080, height = 1440) {
  const tmpFile = path.join(os.tmpdir(), `bionexus_${Date.now()}.html`);
  fs.writeFileSync(tmpFile, htmlContent, 'utf8');

  const playwright = require('playwright');
  const browser = await playwright.chromium.launch({

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

module.exports = { reelPost, recipeDicaReel, singlePost, renderHTML };
