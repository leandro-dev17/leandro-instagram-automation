/**
 * gerador-slides.cjs — Alerta Patriota
 * Gera slides HTML→PNG para Stories e Reels do @roberto.braga.alerta.patriota
 * Usa Puppeteer para renderizar HTML como imagem
 */
const puppeteer = require('puppeteer');
const fs   = require('fs');
const path = require('path');

const OUTPUT_DIR = path.join(__dirname, '../output');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

// ── TEMA VISUAL ────────────────────────────────────────────────────────────
const TEMA = {
  bg:      '#0a0a14',
  bgCard:  '#111122',
  gold:    '#ffd700',
  red:     '#dc2626',
  white:   '#ffffff',
  gray:    '#888888',
  verde:   '#166534',
  amarelo: '#ca8a04',
};

// ── TEMPLATE BASE ──────────────────────────────────────────────────────────
function templateBase(conteudo, tipo = 'story') {
  const w = tipo === 'story' ? 1080 : 1080;
  const h = tipo === 'story' ? 1920 : 1920;

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Bebas+Neue&family=Inter:wght@400;600;700;800;900&display=swap');
    * { margin:0; padding:0; box-sizing:border-box; }
    body {
      width:${w}px; height:${h}px; overflow:hidden;
      background:${TEMA.bg};
      font-family:'Inter',sans-serif;
      color:${TEMA.white};
      position:relative;
    }
    /* Gradiente de fundo */
    .bg-grad {
      position:absolute; inset:0;
      background:radial-gradient(ellipse at top, #1a0800 0%, ${TEMA.bg} 60%);
    }
    /* Bandeira sutil no fundo */
    .bg-flag {
      position:absolute; bottom:0; right:0; width:400px; height:400px;
      opacity:0.04;
      background:
        conic-gradient(from 0deg at 50% 50%,
          #009c3b 0deg 120deg,
          #ffdf00 120deg 240deg,
          #002776 240deg 360deg);
      border-radius:50%;
    }
    .content { position:relative; z-index:2; width:100%; height:100%; }
  </style>
</head>
<body>
  <div class="bg-grad"></div>
  <div class="bg-flag"></div>
  <div class="content">${conteudo}</div>
</body>
</html>`;
}

// ── SLIDE: STORY BOM DIA ───────────────────────────────────────────────────
function htmlStoryBomDia(noticias, logoBase64) {
  const lista = noticias.slice(0, 3).map((n, i) =>
    `<div style="background:rgba(255,255,255,0.04);border-left:3px solid ${TEMA.gold};border-radius:0 8px 8px 0;padding:14px 16px;margin-bottom:12px;">
      <p style="font-size:22px;font-weight:800;line-height:1.3;color:#fff;">${n.titulo}</p>
    </div>`
  ).join('');

  return templateBase(`
    <div style="display:flex;flex-direction:column;height:100%;padding:60px 50px;">
      <!-- Logo e nome -->
      <div style="display:flex;align-items:center;gap:16px;margin-bottom:50px;">
        ${logoBase64 ? `<img src="${logoBase64}" style="width:72px;height:72px;border-radius:50%;border:2px solid ${TEMA.gold};" />` : ''}
        <div>
          <p style="font-family:'Bebas Neue',sans-serif;font-size:28px;letter-spacing:2px;color:${TEMA.gold};">ALERTA PATRIOTA</p>
          <p style="font-size:14px;color:#444;">@roberto.braga.alerta.patriota</p>
        </div>
      </div>

      <!-- Saudação -->
      <p style="font-family:'Bebas Neue',sans-serif;font-size:72px;line-height:1;margin-bottom:8px;">BOM DIA,</p>
      <p style="font-family:'Bebas Neue',sans-serif;font-size:72px;line-height:1;color:${TEMA.gold};margin-bottom:40px;">PATRIOTA! 🇧🇷</p>

      <p style="font-size:20px;color:#888;margin-bottom:28px;font-weight:600;">O que vem por aí hoje:</p>

      <!-- Notícias do dia -->
      ${lista}

      <!-- CTA -->
      <div style="margin-top:auto;text-align:center;padding-top:40px;">
        <p style="font-size:20px;color:#555;margin-bottom:8px;">Análise completa no grupo</p>
        <p style="font-family:'Bebas Neue',sans-serif;font-size:32px;color:${TEMA.gold};letter-spacing:1px;">LINK NA BIO 👆</p>
      </div>
    </div>
  `);
}

// ── SLIDE: NOTÍCIA (para Reel e Story Urgente) ─────────────────────────────
function htmlSlideNoticia(noticia, numero, total, logoBase64) {
  const isUrgente = noticia.urgente;
  const corBorda = isUrgente ? TEMA.red : TEMA.gold;

  return templateBase(`
    <div style="display:flex;flex-direction:column;height:100%;padding:60px 50px;">
      <!-- Header -->
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:60px;">
        <div style="display:flex;align-items:center;gap:12px;">
          ${logoBase64 ? `<img src="${logoBase64}" style="width:56px;height:56px;border-radius:50%;border:2px solid ${corBorda};" />` : ''}
          <p style="font-family:'Bebas Neue',sans-serif;font-size:22px;letter-spacing:1px;color:${corBorda};">ALERTA PATRIOTA</p>
        </div>
        ${total > 1 ? `<p style="font-size:18px;color:#444;font-weight:700;">${numero}/${total}</p>` : ''}
      </div>

      <!-- Badge urgente -->
      ${isUrgente ? `<div style="display:inline-block;background:#7f1d1d;color:#fca5a5;font-size:16px;font-weight:900;padding:6px 18px;border-radius:999px;margin-bottom:24px;width:fit-content;letter-spacing:1px;">🚨 URGENTE</div>` : ''}

      <!-- Título -->
      <h1 style="font-size:${noticia.titulo.length > 60 ? '42px' : '52px'};font-weight:900;line-height:1.2;margin-bottom:36px;flex:1;display:flex;align-items:center;">
        ${noticia.titulo}
      </h1>

      <!-- Resumo (2 linhas) -->
      <div style="background:rgba(255,255,255,0.04);border-left:4px solid ${corBorda};border-radius:0 12px 12px 0;padding:20px 22px;margin-bottom:40px;">
        <p style="font-size:22px;line-height:1.6;color:#ccc;">
          ${(noticia.resumo_braga || '').split('.').slice(0, 2).join('. ')}.
        </p>
      </div>

      <!-- CTA -->
      <div style="background:rgba(255,215,0,0.08);border:1px solid rgba(255,215,0,0.2);border-radius:14px;padding:20px 24px;text-align:center;">
        <p style="font-size:18px;color:#888;margin-bottom:6px;">Análise completa do Capitão Braga</p>
        <p style="font-family:'Bebas Neue',sans-serif;font-size:36px;color:${TEMA.gold};letter-spacing:1px;">LINK NA BIO 👆</p>
      </div>
    </div>
  `);
}

// ── SLIDE: TERMÔMETRO DA LIBERDADE ─────────────────────────────────────────
function htmlSlideTermometro(indicador, valor, analise, logoBase64) {
  const emoji = valor >= 7 ? '🟢' : valor >= 5 ? '🟡' : '🔴';
  const cor   = valor >= 7 ? '#22c55e' : valor >= 5 ? '#f59e0b' : '#ef4444';
  const pct   = (valor / 10) * 100;

  return templateBase(`
    <div style="display:flex;flex-direction:column;height:100%;padding:80px 60px;justify-content:center;">
      <!-- Header -->
      <div style="text-align:center;margin-bottom:70px;">
        <p style="font-family:'Bebas Neue',sans-serif;font-size:28px;color:${TEMA.gold};letter-spacing:3px;margin-bottom:6px;">TERMÔMETRO DA LIBERDADE</p>
        <p style="font-size:16px;color:#444;">@roberto.braga.alerta.patriota</p>
      </div>

      <!-- Indicador -->
      <p style="font-size:24px;color:#888;margin-bottom:20px;font-weight:600;">${indicador}</p>

      <!-- Nota grande -->
      <div style="display:flex;align-items:center;gap:24px;margin-bottom:32px;">
        <p style="font-family:'Bebas Neue',sans-serif;font-size:140px;line-height:1;color:${cor};">${valor}</p>
        <div>
          <p style="font-size:60px;line-height:1;">${emoji}</p>
          <p style="font-size:24px;color:#555;margin-top:8px;">/10</p>
        </div>
      </div>

      <!-- Barra de progresso -->
      <div style="background:rgba(255,255,255,0.06);border-radius:999px;height:16px;margin-bottom:40px;">
        <div style="background:${cor};height:16px;border-radius:999px;width:${pct}%;transition:width 0.5s;"></div>
      </div>

      <!-- Análise -->
      <div style="background:rgba(255,255,255,0.04);border-radius:14px;padding:24px;">
        <p style="font-size:22px;line-height:1.6;color:#bbb;">${analise}</p>
      </div>

      <p style="margin-top:auto;text-align:center;font-family:'Bebas Neue',sans-serif;font-size:24px;color:${TEMA.gold};letter-spacing:1px;padding-top:40px;">DEUS, PÁTRIA E FAMÍLIA — SEMPRE.</p>
    </div>
  `);
}

// ── RENDERIZAR HTML → PNG ──────────────────────────────────────────────────
async function renderizarPng(html, nomeArquivo, largura = 1080, altura = 1920) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu'],
  });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: largura, height: altura, deviceScaleFactor: 1 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });

    const outputPath = path.join(OUTPUT_DIR, nomeArquivo);
    await page.screenshot({ path: outputPath, type: 'png', fullPage: false, clip: { x:0, y:0, width:largura, height:altura } });
    return outputPath;
  } finally {
    await browser.close();
  }
}

// ── CARREGAR LOGO ──────────────────────────────────────────────────────────
function carregarLogoBase64() {
  const logoPath = path.join(__dirname, '../../app/public/logo.png');
  if (!fs.existsSync(logoPath)) return null;
  const data = fs.readFileSync(logoPath);
  return `data:image/png;base64,${data.toString('base64')}`;
}

module.exports = {
  htmlStoryBomDia,
  htmlSlideNoticia,
  htmlSlideTermometro,
  renderizarPng,
  carregarLogoBase64,
  OUTPUT_DIR,
};
