#!/usr/bin/env node
/**
 * whatsapp-cards.cjs — Alerta Patriota
 * Gera cards visuais (imagem + texto) para os 4 grupos WhatsApp
 * Roda via GitHub Actions — usa Puppeteer com Chromium disponível no GA
 *
 * Fluxo: DB → HTML → PNG (Puppeteer) → Cloudinary → Evolution API
 */
'use strict';

const path      = require('path');
const fs        = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { neon }        = require('@neondatabase/serverless');
const Anthropic       = require('@anthropic-ai/sdk');
const puppeteer       = require('puppeteer');
const cloudinary      = require('cloudinary').v2;

// ── CONFIG ─────────────────────────────────────────────────────────────────
const DB_URL   = process.env.DATABASE_URL;
const EVO_URL  = process.env.EVOLUTION_API_URL;
const EVO_KEY  = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || 'alertapatriota';

const GROUP_IDS = {
  basico:   process.env.WPP_GROUP_BASICO,
  patriota: process.env.WPP_GROUP_PATRIOTA,
  vip:      process.env.WPP_GROUP_VIP,
  elite:    process.env.WPP_GROUP_ELITE,
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sql       = neon(DB_URL);
const OUTPUT    = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });

// ── PERSONAS ───────────────────────────────────────────────────────────────
const PERSONAS_DIR = path.join(__dirname, '../app/public/personas');

const PERSONAS = {
  basico:   { nome:'Capitão Roberto Braga',        titulo:'ALERTA BÁSICO',   cor:'#ffd700', label:'ALERTA BÁSICO',  fotos:['braga-mesa.png','braga-microfone.png','braga-direto.png'],  assinatura:'Comentarista · Alerta Patriota' },
  patriota: { nome:'Capitão Roberto Braga',        titulo:'ALERTA PATRIOTA', cor:'#ffd700', label:'ALERTA PATRIOTA',fotos:['braga-microfone.png','braga-direto.png','braga-mesa.png'],   assinatura:'Comentarista · Alerta Patriota' },
  vip:      { nome:'Capitão Roberto Braga',        titulo:'VIP PREMIUM',     cor:'#ff4444', label:'VIP PREMIUM',    fotos:['braga-direto.png','braga-microfone.png','braga-mesa.png'],   assinatura:'Comentarista · Alerta Patriota' },
  elite:    { nome:'Prof. Dr. Bernardo Cavalcanti',titulo:'ELITE GLOBAL',    cor:'#a855f7', label:'ELITE GLOBAL',   fotos:['cavalcanti-capitolio.png','cavalcanti-parlamento.png','cavalcanti-londres.png','cavalcanti-microfone.png'], assinatura:'Ex-USP · Consultor Internacional' },
};

const HOOK_PROMPTS = {
  basico:   'Crie UMA frase de impacto (máximo 12 palavras) sobre esta notícia no tom do Capitão Braga. Direto, patriótico. SEM aspas.',
  patriota: 'Crie UMA frase de impacto (máximo 12 palavras) sobre esta notícia. Indignado e direto. SEM aspas.',
  vip:      'Crie UMA frase bombástica que cause IMPACTO e CURIOSIDADE (máximo 12 palavras). Tom: "o que a mídia esconde". SEM aspas.',
  elite:    'Crie UMA frase analítica e sofisticada do Prof. Cavalcanti (máximo 12 palavras). Tom intelectual e revelador. SEM aspas.',
};

const LEGENDA_PROMPTS = {
  basico: `Você é o Capitão Braga. Escreva um comentário curto (3-4 linhas) sobre esta notícia. Direto e patriótico. Sem cabeçalho. Termine com: Deus, Pátria e Família — sempre. Responda APENAS com o texto.`,
  patriota: `Você é o Capitão Braga. Escreva 4-6 linhas: fato + comentário apaixonado. Sem cabeçalho. Termine com: Deus, Pátria e Família — sempre. Responda APENAS com o texto.`,
  vip: `Você é o Capitão Braga. Use este formato EXATO:\n\n🧠 *O QUE ESTÁ ACONTECENDO*\n[2-3 linhas]\n\n🔍 *O QUE A MÍDIA ESCONDE*\n[2-3 linhas]\n\n🎯 *O QUE ISSO SIGNIFICA*\n[2-3 linhas]\n\nTermine com: Deus, Pátria e Família — sempre. Use apenas *negrito*. Responda APENAS com o texto.`,
  elite: `Você é o Prof. Bernardo Cavalcanti. Use este formato EXATO:\n\n🧠 *O QUE ESTÁ ACONTECENDO*\n[2-3 linhas]\n\n🌍 *MAPA GLOBAL*\n[2-3 linhas conectando a Milei, Trump, Orbán]\n\n🎯 *O QUE VOCÊ PRECISA SABER*\n[2-3 linhas sobre implicação]\n\nTermine com: O mundo muda para quem enxerga antes. Use apenas *negrito*. Responda APENAS com o texto.`,
};

// ── HELPERS ────────────────────────────────────────────────────────────────
function fotoBase64(nome) {
  const p = path.join(PERSONAS_DIR, nome);
  if (!fs.existsSync(p)) return '';
  return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
}

function logoBase64() {
  const p = path.join(PERSONAS_DIR, 'logo.png');
  if (!fs.existsSync(p)) return '';
  return `data:image/png;base64,${fs.readFileSync(p).toString('base64')}`;
}

function escolherFoto(fotos) {
  return fotos[new Date().getDate() % fotos.length];
}

function gerarHTML(plano, hook, fonte, urgente) {
  const p = PERSONAS[plano];
  const foto = fotoBase64(escolherFoto(p.fotos));
  const logo = logoBase64();
  const hookLen = hook.length;

  return `<!DOCTYPE html><html><head><meta charset="UTF-8"><style>
  *{margin:0;padding:0;box-sizing:border-box;}
  body{width:1080px;height:1080px;overflow:hidden;background:#000;font-family:-apple-system,sans-serif;}
  .foto{position:absolute;inset:0;background-image:url('${foto}');background-size:cover;background-position:center top;filter:brightness(0.72);}
  .grad{position:absolute;inset:0;background:linear-gradient(to top,rgba(0,0,0,.97) 0%,rgba(0,0,0,.88) 38%,rgba(0,0,0,.45) 62%,rgba(0,0,0,.12) 80%,transparent 100%);}
  .borda{position:absolute;left:0;top:0;bottom:0;width:6px;background:${p.cor};}
  .header{position:absolute;top:32px;left:0;right:0;display:flex;align-items:center;justify-content:space-between;padding:0 36px;}
  .logo-wrap{display:flex;align-items:center;gap:14px;}
  .logo{width:52px;height:52px;border-radius:50%;border:2.5px solid ${p.cor};object-fit:cover;}
  .logo-txt{color:#fff;font-size:18px;font-weight:900;letter-spacing:1px;text-shadow:0 2px 8px rgba(0,0,0,.9);}
  .badge{background:${urgente?'#c0392b':p.cor};color:${urgente?'#fff':'#000'};font-size:14px;font-weight:900;padding:6px 18px;border-radius:999px;letter-spacing:1.5px;}
  .content{position:absolute;bottom:0;left:0;right:0;padding:36px 44px 42px;}
  .urgente{display:inline-block;background:#c0392b;color:#fff;font-size:13px;font-weight:900;padding:5px 14px;border-radius:4px;letter-spacing:2px;margin-bottom:18px;}
  .hook{font-size:${hookLen>90?'36px':hookLen>70?'40px':hookLen>50?'44px':'50px'};font-weight:900;line-height:1.18;color:#fff;text-shadow:0 3px 14px rgba(0,0,0,.95);margin-bottom:22px;letter-spacing:-.5px;}
  .sep{width:56px;height:3px;background:${p.cor};margin-bottom:18px;border-radius:2px;}
  .fonte{display:inline-block;background:rgba(255,255,255,.11);border:1px solid rgba(255,255,255,.18);color:rgba(255,255,255,.75);font-size:13px;padding:4px 13px;border-radius:4px;margin-bottom:18px;font-weight:600;}
  .assin{display:flex;align-items:center;gap:14px;margin-top:6px;}
  .assin-linha{flex:1;height:1px;background:rgba(255,255,255,.14);}
  .assin-nome{font-size:14px;font-weight:700;color:${p.cor};letter-spacing:.4px;text-shadow:0 2px 6px rgba(0,0,0,.8);}
  .assin-cargo{font-size:11px;color:rgba(255,255,255,.5);margin-top:2px;}
  </style></head><body>
  <div class="foto"></div>
  <div class="grad"></div>
  <div class="borda"></div>
  <div class="header">
    <div class="logo-wrap">${logo?`<img src="${logo}" class="logo" />`:''}
      <span class="logo-txt">${p.titulo}</span></div>
    <span class="badge">${urgente?'🚨 URGENTE':p.label}</span>
  </div>
  <div class="content">
    ${urgente?'<div class="urgente">⚡ ALERTA URGENTE</div>':''}
    <div class="hook">${hook}</div>
    <div class="sep"></div>
    <div class="fonte">📰 ${fonte}</div>
    <div class="assin">
      <div class="assin-linha"></div>
      <div><div class="assin-nome">${p.nome}</div><div class="assin-cargo">${p.assinatura}</div></div>
    </div>
  </div>
  </body></html>`;
}

async function gerarHookeClaude(titulo, plano) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 60,
    messages: [{ role: 'user', content: `${HOOK_PROMPTS[plano]}\n\nNOTÍCIA: "${titulo}"` }],
  });
  return msg.content[0].type === 'text' ? msg.content[0].text.trim().replace(/["""]/g, '') : titulo;
}

async function gerarLegendaClaude(titulo, plano, fonte) {
  const hora = new Date().toLocaleTimeString('pt-BR', { hour:'2-digit', minute:'2-digit', timeZone:'America/Sao_Paulo' });
  const data = new Date().toLocaleDateString('pt-BR', { day:'numeric', month:'short', timeZone:'America/Sao_Paulo' });
  const headers = {
    basico:   `╔══════════════════╗\n║  🇧🇷 ALERTA BÁSICO  ║\n╚══════════════════╝\n_${data} · ${hora} · ${fonte}_\n`,
    patriota: `╔══════════════════╗\n║  ⚡ ALERTA PATRIOTA ║\n╚══════════════════╝\n_${data} · ${hora} · ${fonte}_\n`,
    vip:      `╔══════════════════╗\n║   🔥 VIP PREMIUM   ║\n╚══════════════════╝\n_${data} · ${hora} · ${fonte}_\n`,
    elite:    `╔══════════════════╗\n║  🎖️  ELITE GLOBAL  ║\n╚══════════════════╝\n*Prof. Dr. Bernardo Cavalcanti*\n_${data} · ${hora} · ${fonte}_\n`,
  };
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 500,
    messages: [{ role: 'user', content: `${LEGENDA_PROMPTS[plano]}\n\nNOTÍCIA: "${titulo}"\nFONTE: ${fonte}` }],
  });
  const corpo = msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
  return `${headers[plano]}\n${corpo}`;
}

async function enviarImagemWPP(imageUrl, groupJid, legenda) {
  const res = await fetch(`${EVO_URL}/message/sendMedia/${EVO_INST}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({ number: groupJid, mediatype: 'image', media: imageUrl, caption: legenda, fileName: 'alerta-patriota.jpg' }),
  });
  return res.ok;
}

// ── MAIN ───────────────────────────────────────────────────────────────────
async function processarPlano(plano, browser) {
  console.log(`\n  [${plano}] Buscando notícia...`);
  const groupJid = GROUP_IDS[plano];
  if (!groupJid) { console.log(`  ⚠️  Grupo ${plano} não configurado`); return; }

  const isElite = plano === 'elite';
  let rows;
  if (plano === 'basico')   rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_basico=false AND resumo_braga IS NOT NULL AND global=false ORDER BY urgente DESC,created_at DESC LIMIT 1`;
  if (plano === 'patriota') rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_patriota=false AND resumo_braga IS NOT NULL AND global=false ORDER BY urgente DESC,created_at DESC LIMIT 1`;
  if (plano === 'vip')      rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_vip=false AND resumo_braga IS NOT NULL AND global=false ORDER BY urgente DESC,created_at DESC LIMIT 1`;
  if (plano === 'elite')    rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_elite=false AND resumo_cavalcanti IS NOT NULL ORDER BY urgente DESC,global DESC,created_at DESC LIMIT 1`;

  if (!rows.length) { console.log(`  ⚠️  Sem notícia disponível para ${plano}`); return; }
  const n = rows[0];
  const fonte = n.fonte || 'Alerta Patriota';
  console.log(`  📰 Notícia: ${n.titulo.substring(0,60)}...`);

  // Gera hook e legenda em paralelo
  const [hook, legenda] = await Promise.all([
    gerarHookeClaude(n.titulo, plano),
    gerarLegendaClaude(n.titulo, plano, fonte),
  ]);
  console.log(`  💡 Hook: "${hook}"`);

  // Renderiza HTML → PNG
  const html = gerarHTML(plano, hook, fonte, n.urgente);
  const page = await browser.newPage();
  await page.setViewport({ width:1080, height:1080 });
  await page.setContent(html, { waitUntil:'networkidle0', timeout:20000 });
  const pngPath = path.join(OUTPUT, `card-${plano}.png`);
  await page.screenshot({ path: pngPath, type:'png', clip:{x:0,y:0,width:1080,height:1080} });
  await page.close();
  console.log(`  🖼️  PNG gerado: ${pngPath}`);

  // Upload Cloudinary
  const upload = await cloudinary.uploader.upload(pngPath, {
    resource_type: 'image', folder: 'alerta-patriota/cards', public_id: `card-${plano}-${Date.now()}`,
  });
  console.log(`  ☁️  Cloudinary: ${upload.secure_url}`);

  // Envia via WhatsApp
  const ok = await enviarImagemWPP(upload.secure_url, groupJid, legenda);
  if (ok) {
    // Marca como publicada
    if (plano==='basico')   await sql`UPDATE noticias SET postada_basico=true,postada_basico_at=NOW() WHERE id=${n.id}`;
    if (plano==='patriota') await sql`UPDATE noticias SET postada_patriota=true,postada_patriota_at=NOW() WHERE id=${n.id}`;
    if (plano==='vip')      await sql`UPDATE noticias SET postada_vip=true,postada_vip_at=NOW() WHERE id=${n.id}`;
    if (plano==='elite')    await sql`UPDATE noticias SET postada_elite=true,postada_elite_at=NOW() WHERE id=${n.id}`;
    await sql`INSERT INTO agentes_log(agente,acao,status,detalhes) VALUES('gerador-card',${`card_${plano}`},'sucesso',${JSON.stringify({hook,noticiaId:n.id})})`;
    console.log(`  ✅ Card enviado para o grupo ${plano}!`);
  } else {
    console.log(`  ❌ Falha ao enviar para Evolution API`);
  }

  await new Promise(r => setTimeout(r, 3000));
}

async function main() {
  console.log('🎨 Gerando cards visuais — Alerta Patriota');
  const planos = process.argv.slice(2).length ? process.argv.slice(2) : ['basico','patriota','vip','elite'];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXEC_PATH || undefined,
  });

  try {
    for (const plano of planos) {
      if (!PERSONAS[plano]) { console.log(`Plano inválido: ${plano}`); continue; }
      await processarPlano(plano, browser);
    }
  } finally {
    await browser.close();
  }
  console.log('\n✅ Cards concluídos!');
}

main().catch(err => { console.error('❌ Erro:', err.message); process.exit(1); });
