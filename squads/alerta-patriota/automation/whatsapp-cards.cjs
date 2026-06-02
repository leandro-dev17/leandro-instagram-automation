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
const { sendTelegram, horaBRT, dataBRT } = require('./telegram-reporter.cjs');

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

// 9 imagens por persona — rotação 1 por dia (todas as publicações do dia usam a mesma)
const FOTOS_BRAGA = [
  'braga-01.png', // sentado à mesa escritório
  'braga-02.png', // comentando notícia
  'braga-03.png', // ambiente profissional, olhando para câmera
  'braga-04.png', // retrato patriótico
  'braga-05.png', // em pé, apontando, indignado
  'braga-06.png', // cenário rural, questionamento
  'braga-07.png', // terno, estúdio de notícias
  'braga-08.png', // praça, braços abertos
  'braga-09.png', // frente a construção rústica
];

const FOTOS_CAVALCANTI = [
  'cavalcanti-01.png', // imagem redes sociais
  'cavalcanti-02.png', // comentando com microfone
  'cavalcanti-03.png', // Capitólio
  'cavalcanti-04.png', // Londres, beira do rio
  'cavalcanti-05.png', // Parlamento Europeu
  'cavalcanti-06.png', // estúdio com mapa global
  'cavalcanti-07.png', // análise financeira, ambiente moderno
  'cavalcanti-08.png', // estúdio moderno
  'cavalcanti-09.png', // terminal de aeroporto
];

const PERSONAS = {
  basico:   { nome:'Capitão Roberto Braga',        titulo:'ALERTA BÁSICO',   cor:'#ffd700', label:'ALERTA BÁSICO',   fotos: FOTOS_BRAGA,       assinatura:'Comentarista · Alerta Patriota'   },
  patriota: { nome:'Capitão Roberto Braga',        titulo:'ALERTA PATRIOTA', cor:'#ffd700', label:'ALERTA PATRIOTA', fotos: FOTOS_BRAGA,       assinatura:'Comentarista · Alerta Patriota'   },
  vip:      { nome:'Capitão Roberto Braga',        titulo:'VIP PREMIUM',     cor:'#ff4444', label:'VIP PREMIUM',     fotos: FOTOS_BRAGA,       assinatura:'Comentarista · Alerta Patriota'   },
  elite:    { nome:'Prof. Dr. Bernardo Cavalcanti',titulo:'ELITE GLOBAL',    cor:'#a855f7', label:'ELITE GLOBAL',    fotos: FOTOS_CAVALCANTI,  assinatura:'Ex-USP · Consultor Internacional' },
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

// ── FILTRO: exclui notícias irrelevantes (esporte, celebridade, acidente) ──
const PALAVRAS_EXCLUIR = [
  // Acidente / trânsito
  'motociclista','acidente','marginal','tietê','atropel','batida','colisão',
  'morte no trânsito','engavetamento',
  // Saúde, medicina e nutrição
  'nutricionista','nutricionist','dieta','emagrecimento','reeducação alimentar',
  'alimentação saudável','alimento saudável','suplemento','vitamina',
  'câncer de','tumor','oncologia','pressão alta','diabetes','colesterol',
  'remédio caseiro','médico diz','estudo mostra','pesquisa revela',
  'exercício físico','musculação','academia','bem-estar','saúde e bem',
  // Entretenimento e celebridades
  'hospital','internado','internada','faleceu','morreu','obituário',
  'celebridade','famoso','ator','atriz','cantor','cantora','show','novela',
  'fontenelle','xuxa','faustão','gkay','virgínia','influencer',
  // Esporte
  'futebol','copa','campeonato','gol','jogador','atleta','esporte',
  'olimpíada','nba','nfl','tênis','vôlei',
  // Entretenimento digital
  'reality','bbb','masterchef','netflix','série','cinema','streaming',
  // Moda
  'moda','estilo','beleza','biquíni','maquiagem',
  // Prêmios de entretenimento
  'grande otelo','grammy','oscar','emmy','indicados ao prêmio',
];

function ehConteudoIrrelevante(titulo) {
  const t = (titulo || '').toLowerCase();
  return PALAVRAS_EXCLUIR.some(p => t.includes(p));
}

// ── HELPERS ────────────────────────────────────────────────────────────────
const VERCEL_URL     = process.env.NEXT_PUBLIC_APP_URL || 'https://alertapatriota.vercel.app';
const PERSONAS_LOCAL = path.join(__dirname, '../app/public/personas');

// Converte imagem local para base64 data URL
// Embed direto no HTML — sem dependência de URL externa nem file://, funciona sempre
function imgBase64(nome) {
  const localPath = path.join(PERSONAS_LOCAL, nome);
  if (fs.existsSync(localPath)) {
    const data = fs.readFileSync(localPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  }
  // Fallback para Vercel se arquivo local não existir
  return `${VERCEL_URL}/personas/${nome}`;
}

function fotoUrl(nome) { return imgBase64(nome); }
function logoUrl()     { return imgBase64('logo.png'); }

function escolherFoto(fotos) {
  // Cada publicação usa uma imagem diferente, variando pelo horário
  // Combina dia do ano + hora BRT → garante imagem diferente em cada slot do dia
  // e que o mesmo slot não repita a mesma imagem nos dias seguintes
  const agora = new Date();
  const horaBRT = new Date(agora.toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' })).getHours();
  const inicioAno = new Date(agora.getFullYear(), 0, 0);
  const diaDoAno  = Math.floor((agora - inicioAno) / 86400000);
  return fotos[(diaDoAno * 24 + horaBRT) % fotos.length];
}

function gerarHTML(plano, hook, fonte, urgente) {
  const p = PERSONAS[plano];
  const foto = fotoUrl(escolherFoto(p.fotos));
  const logo = logoUrl();
  const isElite = plano === 'elite';

  // Tamanho da fonte do hook baseado no comprimento — legível no celular
  const hl = hook.length;
  const hookSize = hl <= 30 ? '96px' : hl <= 45 ? '82px' : hl <= 60 ? '70px' : '58px';

  // Hook em caixa alta para impacto visual
  const hookUpper = hook.toUpperCase();

  if (isElite) {
    // ── PROF. CAVALCANTI: full-bleed com gradiente roxo ──
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1080px;overflow:hidden;background:#07071a;position:relative;}
.foto{position:absolute;inset:0;
      background:url('${foto}') center top/cover no-repeat;}
.grad{position:absolute;inset:0;
      background:linear-gradient(to bottom,
        rgba(7,7,26,.30) 0%,
        rgba(7,7,26,.0)  14%,
        rgba(7,7,26,.0)  52%,
        rgba(7,7,26,.80) 72%,
        rgba(7,7,26,.96) 100%);}
.badge{position:absolute;top:44px;left:44px;
       background:${urgente?'#7c3aed':'#5b21b6'};color:#e9d5ff;
       font-family:Arial Black,Impact,sans-serif;
       font-size:24px;font-weight:900;letter-spacing:4px;
       padding:12px 28px;text-transform:uppercase;}
${logo ? `.logo{position:absolute;top:36px;right:44px;
  width:68px;height:68px;border-radius:50%;
  border:3px solid #a855f7;object-fit:cover;}`:''}
.hook{position:absolute;bottom:148px;left:0;right:0;padding:0 50px;
      font-family:Arial Black,Impact,sans-serif;
      font-size:${hookSize};font-weight:900;color:#fff;
      line-height:1.05;text-transform:uppercase;
      text-shadow:0 4px 24px rgba(0,0,0,.95);}
.footer{position:absolute;bottom:0;left:0;right:0;
        background:rgba(88,28,135,.9);
        border-top:3px solid #a855f7;
        padding:24px 44px;
        display:flex;align-items:center;justify-content:space-between;}
.f-left{font-size:20px;font-weight:900;color:#e9d5ff;
        letter-spacing:2px;text-transform:uppercase;}
.f-right{text-align:right;}
.f-nome{font-size:18px;font-weight:800;color:#fff;}
.f-cargo{font-size:11px;color:rgba(233,213,255,.6);
         letter-spacing:1px;margin-top:3px;text-transform:uppercase;}
</style></head><body>
  <div class="foto"></div>
  <div class="grad"></div>
  <div class="badge">${urgente ? '🚨 URGENTE' : 'ANÁLISE GLOBAL'}</div>
  ${logo ? `<img src="${logo}" class="logo"/>` : ''}
  <div class="hook">${hookUpper}</div>
  <div class="footer">
    <div class="f-left">O MUNDO MUDA PARA<br>QUEM ENXERGA ANTES.</div>
    <div class="f-right">
      <div class="f-nome">PROF. BERNARDO CAVALCANTI</div>
      <div class="f-cargo">ELITE GLOBAL</div>
    </div>
  </div>
</body></html>`;
  }

  // ── CAPITÃO BRAGA: full-bleed foto com texto grande e impactante ──
  const BADGE_LABEL = {
    basico:   urgente ? '🚨 URGENTE'    : 'POLÍTICA',
    patriota: urgente ? '🚨 URGENTE'    : 'ANÁLISE PATRIOTA',
    vip:      urgente ? '🚨 URGENTE'    : '🔥 VIP EXCLUSIVO',
  };
  const badge = BADGE_LABEL[plano] || 'POLÍTICA';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1080px;overflow:hidden;background:#000;position:relative;}
.foto{position:absolute;inset:0;
      background:url('${foto}') center top/cover no-repeat;}
.grad{position:absolute;inset:0;
      background:linear-gradient(to bottom,
        rgba(0,0,0,.28) 0%,
        rgba(0,0,0,.0)  14%,
        rgba(0,0,0,.0)  52%,
        rgba(0,0,0,.80) 72%,
        rgba(0,0,0,.96) 100%);}
.badge{position:absolute;top:44px;left:44px;
       background:#c0392b;color:#fff;
       font-family:Arial Black,Impact,sans-serif;
       font-size:24px;font-weight:900;letter-spacing:3px;
       padding:12px 28px;text-transform:uppercase;}
${logo ? `.logo{position:absolute;top:36px;right:44px;
  width:68px;height:68px;border-radius:50%;
  border:3px solid #ffd700;object-fit:cover;}`:''}
.hook{position:absolute;bottom:148px;left:0;right:0;padding:0 50px;
      font-family:Arial Black,Impact,sans-serif;
      font-size:${hookSize};font-weight:900;color:#fff;
      line-height:1.05;text-transform:uppercase;
      text-shadow:0 4px 24px rgba(0,0,0,.95);}
.footer{position:absolute;bottom:0;left:0;right:0;
        background:#c0392b;
        padding:24px 44px;
        display:flex;align-items:center;justify-content:space-between;}
.f-left{font-size:20px;font-weight:900;color:#fff;
        letter-spacing:2px;text-transform:uppercase;}
.f-right{text-align:right;}
.f-nome{font-size:18px;font-weight:800;color:#fff;}
.f-cargo{font-size:11px;color:rgba(255,255,255,.7);
         letter-spacing:1px;margin-top:3px;text-transform:uppercase;}
</style></head><body>
  <div class="foto"></div>
  <div class="grad"></div>
  <div class="badge">${badge}</div>
  ${logo ? `<img src="${logo}" class="logo"/>` : ''}
  <div class="hook">${hookUpper}</div>
  <div class="footer">
    <div class="f-left">DEUS, PÁTRIA E FAMÍLIA</div>
    <div class="f-right">
      <div class="f-nome">CAPITÃO ROBERTO BRAGA</div>
      <div class="f-cargo">ALERTA PATRIOTA</div>
    </div>
  </div>
</body></html>`;
}

async function gerarHookeClaude(titulo, plano) {
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001', max_tokens: 60,
    messages: [{ role: 'user', content: `${HOOK_PROMPTS[plano]}\n\nNOTÍCIA: "${titulo}"` }],
  });
  return msg.content[0].type === 'text'
    ? msg.content[0].text.trim().replace(/["""]/g, '').replace(/^#+\s*/, '')
    : titulo;
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
    body: JSON.stringify({
      number: groupJid,
      mediaMessage: {
        mediatype: 'image',
        media: imageUrl,
        caption: legenda,
        fileName: 'alerta-patriota.jpg',
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.log(`  ⚠️  Evolution API ${res.status}: ${err.substring(0, 150)}`);
  }
  return res.ok;
}

// ── ENVIO DE TEXTO SIMPLES (para FOMO e avisos) ────────────────────────────
async function enviarTextoWPP(groupJid, texto) {
  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({ number: groupJid, textMessage: { text: texto } }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.log(`  ⚠️  sendText ${res.status}: ${err.substring(0, 100)}`);
  }
  return res.ok;
}

// ── FÁBIO FOMO — teaser para grupos inferiores (máx 2x/dia, espaçado 10h) ──
async function fomoEnviadoRecentemente() {
  try {
    const rows = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'fabio-fomo'
        AND status = 'sucesso'
        AND created_at > NOW() - INTERVAL '10 hours'
      LIMIT 1
    `;
    return rows.length > 0;
  } catch { return false; }
}

async function dispararFOMO(hook, planoExclusivo) {
  // Rate limit: só envia se passaram pelo menos 10h desde o último FOMO
  // Resultado: ~2 envios/dia (manhã e noite), sem spam
  if (await fomoEnviadoRecentemente()) {
    console.log('  ⏭️  FOMO: já enviado nas últimas 10h — pulando');
    return 0;
  }

  const label     = planoExclusivo === 'elite' ? 'Elite Global' : 'VIP Premium';
  const hookCurto = hook.length > 70 ? hook.substring(0, 67) + '...' : hook;

  const mensagem = `🔥 *EXCLUSIVO ${label.toUpperCase()} — AGORA*\n\n"${hookCurto}"\n\n👆 Essa análise só os membros ${label} receberam hoje.\n\nFaça upgrade e nunca mais perca as análises mais profundas do Alerta Patriota:\n👉 alertapatriota.vercel.app`;

  // Elite → Básico + Patriota + VIP | VIP → Básico + Patriota
  const destinos = planoExclusivo === 'elite'
    ? [GROUP_IDS.basico, GROUP_IDS.patriota, GROUP_IDS.vip]
    : [GROUP_IDS.basico, GROUP_IDS.patriota];

  let enviados = 0;
  for (const jid of destinos) {
    if (!jid) continue;
    if (await enviarTextoWPP(jid, mensagem)) enviados++;
    await new Promise(r => setTimeout(r, 2000));
  }

  if (enviados > 0) {
    // Registra o envio para o rate limit funcionar
    await sql`
      INSERT INTO agentes_log(agente, acao, status, detalhes)
      VALUES('fabio-fomo', 'fomo_enviado', 'sucesso',
        ${JSON.stringify({ plano: planoExclusivo, destinos: destinos.length, enviados })})
    `.catch(() => {});
  }

  console.log(`  🔥 FOMO: ${enviados}/${destinos.length} grupos notificados`);
  return enviados;
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

  // Filtra notícias irrelevantes (esporte, celebridade, acidente etc)
  const rowsFiltradas = (rows || []).filter(r => !ehConteudoIrrelevante(r.titulo));
  if (!rowsFiltradas.length) { console.log(`  ⚠️  Sem notícia política disponível para ${plano}`); return; }
  const n = rowsFiltradas[0];
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

  // Imagens já estão em base64 no HTML — sem requests externos, sem file://
  // domcontentloaded é suficiente; aguardamos 1.5s para CSS pintar o background
  const page = await browser.newPage();
  await page.setViewport({ width:1080, height:1080 });
  await page.setContent(html, { waitUntil:'domcontentloaded', timeout:20000 });
  await new Promise(r => setTimeout(r, 1500));
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
    await sendTelegram(`❌ *FALHA — Card WhatsApp*\nGrupo: ${plano}\nHook: "${hook.substring(0, 60)}"\n🕐 ${horaBRT()} BRT`);
  }

  await new Promise(r => setTimeout(r, 3000));
  return ok ? hook : null;
}

async function main() {
  console.log('🎨 Gerando cards visuais — Alerta Patriota');
  const planos = process.argv.slice(2).length ? process.argv.slice(2) : ['basico','patriota','vip','elite'];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXEC_PATH || undefined,
  });

  const resultados = [];
  let melhorHookVIP   = null;
  let melhorHookElite = null;

  try {
    for (const plano of planos) {
      if (!PERSONAS[plano]) { console.log(`Plano inválido: ${plano}`); continue; }
      try {
        const hook = await processarPlano(plano, browser);
        resultados.push({ plano, ok: true });
        // Guarda o hook para FOMO (só 1 por rodada)
        if (plano === 'vip'   && hook && !melhorHookVIP)   melhorHookVIP   = hook;
        if (plano === 'elite' && hook && !melhorHookElite) melhorHookElite = hook;
      } catch (e) {
        console.error(`  ❌ Erro no plano ${plano}:`, e.message);
        resultados.push({ plano, ok: false, erro: e.message });
      }
    }
  } finally {
    await browser.close();
  }

  // Fábio FOMO — dispara APENAS 1× por rodada, usando o melhor hook disponível
  // Prioriza Elite (mais premium), depois VIP
  const hookFOMO  = melhorHookElite || melhorHookVIP;
  const planoFOMO = melhorHookElite ? 'elite' : melhorHookVIP ? 'vip' : null;
  if (hookFOMO && planoFOMO) {
    console.log('\n🔥 Disparando FOMO único para Básico + Patriota...');
    await dispararFOMO(hookFOMO, planoFOMO);
  }

  // Resumo no Telegram
  const ok  = resultados.filter(r => r.ok).map(r => `✅ ${r.plano}`).join('\n');
  const err = resultados.filter(r => !r.ok).map(r => `❌ ${r.plano}: ${r.erro?.substring(0,60)}`).join('\n');
  const fomoTxt = planoFOMO ? `\n🔥 FOMO enviado (${planoFOMO})` : '';

  await sendTelegram(
    `🎨 *Cards Visuais — Alerta Patriota*\n📅 ${dataBRT()} · ${horaBRT()} BRT\n\n${ok}${err ? '\n' + err : ''}${fomoTxt}`
  );

  console.log('\n✅ Cards concluídos!');
}

main().catch(err => { console.error('❌ Erro:', err.message); process.exit(1); });
