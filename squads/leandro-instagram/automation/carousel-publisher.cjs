/**
 * carousel-publisher.cjs — Publica carrossel de 7 slides no Instagram
 *
 * Publica carousel-slide1.png até carousel-slide7.png como post carrossel.
 * Gerados pelo daily-generator.cjs com 1 imagem base reutilizada.
 *
 * Uso: node carousel-publisher.cjs [data]
 *   data (opcional): YYYY-MM-DD — padrão: hoje
 *
 * Horário automático (Task Scheduler): 12:00h
 */

'use strict';

const fs             = require('fs');
const path           = require('path');
const { execFileSync } = require('child_process');

// Carrega .env
(function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) process.env[k.trim()] = v.join('=').trim();
  }
})();

const { uploadImage }                                    = require('./lib/cloudinary.cjs');
const { publishCarousel, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { notifyPost, notifyError }                        = require('./lib/telegram.cjs');

const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const TOTAL_SLIDES = 7;

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'carousel-publisher.log'), line + '\n');
}

function today() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  return new Date().toISOString().slice(0, 10);
}

function findDayPlan(dateStr) {
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files.sort().reverse()) {
    const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
    if (plan.days && plan.days[dateStr]) return plan.days[dateStr];
  }
  return null;
}

async function main() {
  const dateStr = today();

  log('═══════════════════════════════════════════');
  log(`Carousel Publisher — ${TOTAL_SLIDES} slides`);
  log(`Data: ${dateStr}`);
  log('═══════════════════════════════════════════');

  // Verifica se já foi publicado hoje
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(trackingFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) tracking = parsed;
      else throw new Error('estrutura inválida');
    } catch {
      log('⚠️ published-posts.json corrompido — reiniciando arquivo');
      fs.writeFileSync(trackingFile, '{}');
    }
  }
  if (tracking[dateStr] && tracking[dateStr]['carousel']) {
    const existing = tracking[dateStr]['carousel'];
    log(`⚠️  Carrossel já publicado hoje às ${existing.publishedAt} (ID: ${existing.postId})`);
    log('   Pulando para evitar duplicata.');
    process.exit(0);
  }

  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  const slide1 = path.join(outDir, 'carousel-slide1.png');

  // Se slides não existem, roda o gerador automaticamente (fallback para quando PC dormia às 05h)
  if (!fs.existsSync(slide1)) {
    log('⚠️  Slides não encontrados — rodando daily-generator.cjs automaticamente...');
    const generatorPath = path.join(__dirname, 'daily-generator.cjs');
    try {
      execFileSync(process.execPath, [generatorPath], { stdio: 'inherit', timeout: 15 * 60 * 1000 });
      log('✅ Gerador concluído. Continuando publicação...');
    } catch (err) {
      log(`ERRO FATAL: Gerador falhou: ${err.message}`);
      process.exit(1);
    }
  }

  if (!fs.existsSync(outDir)) {
    log(`ERRO: Pasta não encontrada após gerador: ${outDir}`);
    process.exit(1);
  }

  // Verifica existência de todos os slides
  const slidePaths = [];
  for (let n = 1; n <= TOTAL_SLIDES; n++) {
    const slidePath = path.join(outDir, `carousel-slide${n}.png`);
    if (!fs.existsSync(slidePath)) {
      log(`ERRO: Slide ${n} não encontrado após gerador: carousel-slide${n}.png`);
      process.exit(1);
    }
    slidePaths.push(slidePath);
  }

  // Carrega plano do dia para caption e hashtags
  const dayPlan = findDayPlan(dateStr);
  const carousel = dayPlan?.carousel || {};
  const IG_CAPTION_LIMIT = 2200;
  const hashtags = carousel.hashtags || '';
  let rawCaption = carousel.caption || carousel.topic || 'Conteúdo fitness';
  // Garante que caption+hashtags nunca ultrapassam o limite do Instagram
  const hashtagsPart = hashtags ? `\n\n${hashtags}` : '';
  const maxCaptionLen = IG_CAPTION_LIMIT - hashtagsPart.length - 4; // -4 para "...\n"
  if (rawCaption.length > maxCaptionLen) {
    const cut = rawCaption.slice(0, maxCaptionLen);
    const lastPara = cut.lastIndexOf('\n\n');
    rawCaption = (lastPara > 100 ? cut.slice(0, lastPara) : cut) + '...';
  }
  const caption = `${rawCaption}${hashtagsPart}`.trim();

  log(`Tema: ${carousel.topic || 'N/A'}`);
  log(`Caption: ${caption.slice(0, 80)}...`);

  const env    = loadEnv();
  const token  = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // Upload de todos os slides para Cloudinary
  log('');
  log(`📤 Fazendo upload de ${TOTAL_SLIDES} slides para Cloudinary...`);
  const imageUrls = [];
  for (let i = 0; i < slidePaths.length; i++) {
    const url = await uploadImage(slidePaths[i]);
    log(`  Slide ${i + 1}/${TOTAL_SLIDES}: ${url}`);
    imageUrls.push(url);
  }

  // Publica como carrossel
  log('');
  log('📱 Publicando carrossel no Instagram...');
  const postId = await publishCarousel(imageUrls, caption, token, userId);

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ CARROSSEL PUBLICADO COM SUCESSO!`);
  log(`   Instagram Post ID: ${postId}`);
  log(`   Slides: ${TOTAL_SLIDES}`);
  log(`   Tema: ${carousel.topic || 'N/A'}`);
  log('═══════════════════════════════════════════');

  // Notifica Telegram
  await notifyPost('carousel', carousel.type || 'carrossel', postId, dateStr);

  // Rastreamento
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr]['carousel'] = {
    postId,
    publishedAt: new Date().toISOString(),
    topic: carousel.topic,
    slides: TOTAL_SLIDES
  };
  try {
    fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
  } catch (e) {
    log(`⚠️ Falha ao salvar tracking: ${e.message}`);
  }
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('carousel-publisher.cjs', err.message);
  process.exit(1);
});
