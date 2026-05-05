/**
 * instagram-publisher.cjs
 * Publica um post do feed no Instagram automaticamente.
 *
 * Uso: node instagram-publisher.cjs <numero-do-post> [data]
 *   numero-do-post: 1 (motivacional 7h), 2 (educativo 12h), 3 (científico/mitos 18h)
 *   data (opcional): YYYY-MM-DD  — padrão: hoje
 *
 * Exemplos:
 *   node instagram-publisher.cjs 1
 *   node instagram-publisher.cjs 2 2026-04-01
 */

const fs = require('fs');
const path = require('path');
const { uploadImage } = require('./lib/cloudinary.cjs');
const { publishPost, publishCarousel, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { notifyPost, notifyError } = require('./lib/telegram.cjs');

const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';

// ─── UTILIDADES ─────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'publisher.log'), line + '\n');
}

function today() {
  const arg = process.argv[3];
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

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  const postIndex = parseInt(process.argv[2]);
  if (!postIndex || postIndex < 1 || postIndex > 3) {
    console.error('Uso: node instagram-publisher.cjs <1|2|3> [YYYY-MM-DD]');
    console.error('  1 = motivacional (7h)');
    console.error('  2 = educativo (12h)');
    console.error('  3 = científico/mitos (18h)');
    process.exit(1);
  }

  const dateStr = today();
  const postLabels = { 1: 'motivacional (7h)', 2: 'educativo (12h)', 3: 'científico/mitos (18h)' };

  log('═══════════════════════════════════════════');
  log(`Instagram Publisher — Post ${postIndex}: ${postLabels[postIndex]}`);
  log(`Data: ${dateStr}`);
  log('═══════════════════════════════════════════');

  // Verifica se já foi publicado hoje (evita duplicatas em re-runs)
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  if (fs.existsSync(trackingFile)) {
    try {
      const tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8'));
      if (tracking[dateStr] && tracking[dateStr][String(postIndex)]) {
        const existing = tracking[dateStr][String(postIndex)];
        log(`⚠️  Post ${postIndex} já publicado hoje às ${existing.publishedAt} (ID: ${existing.postId})`);
        log('   Pulando para evitar duplicata.');
        process.exit(0);
      }
    } catch {}
  }

  // Carrega plano do dia
  const dayPlan = findDayPlan(dateStr);
  if (!dayPlan) {
    log(`ERRO: Nenhum cronograma para ${dateStr}. Execute weekly-planner.cjs.`);
    process.exit(1);
  }

  // Suporta formato novo (carousel/story/reel_kling) e formato legado (posts[])
  let post;
  if (dayPlan.posts && dayPlan.posts[postIndex - 1]) {
    post = dayPlan.posts[postIndex - 1];
  } else if (postIndex === 1 && dayPlan.carousel) {
    post = { type: 'carousel', ...dayPlan.carousel };
  } else {
    log(`Post ${postIndex} não existe neste cronograma — pulando.`);
    process.exit(0);
  }

  log(`Tipo: ${post.type}`);

  // Encontra arquivo de imagem
  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  if (!fs.existsSync(outDir)) {
    log(`ERRO: Pasta não encontrada: ${outDir}`);
    log('Execute daily-generator.cjs primeiro para gerar as imagens.');
    process.exit(1);
  }

  const files = fs.readdirSync(outDir);

  // Detecta slides de carrossel — formato novo (carousel-slideN.png) ou legado (post-X-slideN.png)
  let carouselSlides = [];
  // Formato novo: carousel-slide1.png ... carousel-slide7.png
  const newSlides = files.filter(f => /^carousel-slide\d+\.png$/.test(f)).sort();
  if (newSlides.length >= 2) {
    carouselSlides = newSlides;
  } else {
    // Formato legado: post-X-slide1.png ...
    for (let s = 1; s <= 10; s++) {
      const f = files.find(fn => fn === `post-${postIndex}-slide${s}.png`);
      if (f) carouselSlides.push(f); else break;
    }
  }
  const isCarousel = carouselSlides.length >= 2;

  // Fallback: imagem única (formato legado)
  const singleFile = !isCarousel ? files.find(f => f.startsWith(`post-${postIndex}-`) && f.endsWith('.png') && !f.includes('raw')) : null;

  if (!isCarousel && !singleFile) {
    log(`ERRO: Imagem(ns) do post ${postIndex} não encontrada(s) em ${outDir}`);
    process.exit(1);
  }

  // Carrega credenciais e renova token se necessário
  const env = loadEnv();
  if (!env.INSTAGRAM_USER_ID) {
    log('ERRO: INSTAGRAM_USER_ID não configurado no .env');
    log('Siga o guia em INSTAGRAM-SETUP.md para configurar.');
    process.exit(1);
  }

  const token = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // Monta caption
  const caption = `${post.caption}\n\n${post.hashtags}`;
  log(`Caption: ${caption.slice(0, 80)}...`);

  let postId;

  if (isCarousel) {
    log(`Modo: carrossel (${carouselSlides.length} slides)`);
    log('');
    log(`📤 Fazendo upload dos ${carouselSlides.length} slides para Cloudinary...`);
    const slidePaths = carouselSlides.map(f => path.join(outDir, f));
    const imageUrls = [];
    for (let i = 0; i < slidePaths.length; i++) {
      const url = await uploadImage(slidePaths[i]);
      log(`  Slide ${i + 1}: ${url}`);
      imageUrls.push(url);
    }

    log('');
    log('📱 Publicando carrossel no Instagram...');
    postId = await publishCarousel(imageUrls, caption, token, userId);
  } else {
    log(`Modo: post único (legado)`);
    const imgPath = path.join(outDir, singleFile);
    log(`Imagem: ${singleFile}`);
    log('');
    log('📤 Fazendo upload para Cloudinary...');
    const imageUrl = await uploadImage(imgPath);
    log(`✅ URL pública: ${imageUrl}`);

    log('');
    log('📱 Publicando no Instagram...');
    postId = await publishPost(imageUrl, caption, token, userId);
  }

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ POST ${postIndex} PUBLICADO COM SUCESSO!`);
  log(`   Instagram Post ID: ${postId}`);
  log(`   Tipo: ${post.type}`);
  log(`   Formato: ${isCarousel ? 'Carrossel (3 slides)' : 'Post único'}`);
  log('═══════════════════════════════════════════');

  // Notifica Telegram
  await notifyPost(postIndex, post.type, postId, dateStr);

  // Atualiza published-posts.json para rastreamento
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(trackingFile, 'utf8'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) tracking = parsed;
    } catch {}
  }
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr][String(postIndex)] = { postId, publishedAt: new Date().toISOString(), type: post.type, format: isCarousel ? 'carousel' : 'single' };
  const tmpFile = trackingFile + '.tmp';
  fs.writeFileSync(tmpFile, JSON.stringify(tracking, null, 2));
  fs.renameSync(tmpFile, trackingFile);
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('instagram-publisher.cjs', err.message);
  process.exit(1);
});
