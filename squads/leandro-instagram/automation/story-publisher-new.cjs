/**
 * story-publisher-new.cjs — Publica 5 slides de Story no Instagram
 *
 * Publica story-slide1.png até story-slide5.png como Stories individuais.
 * Gerados pelo daily-generator.cjs com 1 imagem base reutilizada.
 *
 * Uso: node story-publisher-new.cjs [data]
 *   data (opcional): YYYY-MM-DD — padrão: hoje
 *
 * Horário automático (Task Scheduler): 07:00h
 */

'use strict';

const fs   = require('fs');
const path = require('path');

// Carrega .env
(function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) process.env[k.trim()] = v.join('=').trim();
  }
})();

const { uploadImage }                          = require('./lib/cloudinary.cjs');
const { publishStory, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { notifyStory, notifyError }             = require('./lib/telegram.cjs');

const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const TOTAL_SLIDES = 5;

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'story-publisher.log'), line + '\n');
}

function today() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  return new Date().toISOString().slice(0, 10);
}

function isPublished(tracking, dateStr, key) {
  return !!(tracking[dateStr] && tracking[dateStr][key]);
}

function savePublished(dateStr, key, data) {
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try { tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch {}
  }
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr][key] = { ...data, publishedAt: new Date().toISOString() };
  fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
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
  log(`Story Publisher (novo) — ${TOTAL_SLIDES} slides`);
  log(`Data: ${dateStr}`);
  log('═══════════════════════════════════════════');

  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  if (!fs.existsSync(outDir)) {
    log(`ERRO: Pasta não encontrada: ${outDir}`);
    log('Execute daily-generator.cjs primeiro.');
    process.exit(1);
  }

  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try { tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch {}
  }

  // Verifica se todos os slides já foram publicados
  const allDone = Array.from({ length: TOTAL_SLIDES }, (_, i) => i + 1)
    .every(n => isPublished(tracking, dateStr, `story-new-${n}`));
  if (allDone) {
    log(`⚠️  Todos os ${TOTAL_SLIDES} slides de story já publicados hoje — pulando.`);
    process.exit(0);
  }

  const env    = loadEnv();
  const token  = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  const dayPlan = findDayPlan(dateStr);

  let published = 0;

  for (let n = 1; n <= TOTAL_SLIDES; n++) {
    const key      = `story-new-${n}`;
    const slideName = `story-slide${n}.png`;
    const slidePath = path.join(outDir, slideName);

    if (isPublished(tracking, dateStr, key)) {
      log(`  ⏭️  Slide ${n}/${TOTAL_SLIDES} já publicado — pulando`);
      continue;
    }

    if (!fs.existsSync(slidePath)) {
      log(`  ⚠️  Slide ${n}/${TOTAL_SLIDES} não encontrado: ${slideName} — pulando`);
      continue;
    }

    log(`\n  📤 Slide ${n}/${TOTAL_SLIDES}: fazendo upload...`);
    const imageUrl = await uploadImage(slidePath);
    log(`     URL: ${imageUrl}`);

    log(`  📱 Publicando story ${n}/${TOTAL_SLIDES}...`);
    const postId = await publishStory(imageUrl, token, userId);
    log(`  ✅ Story ${n} publicado — ID: ${postId}`);

    savePublished(dateStr, key, { postId, slide: n, image: slideName });
    published++;

    // Pausa 3s entre stories para não sobrecarregar a API
    if (n < TOTAL_SLIDES) await new Promise(r => setTimeout(r, 3000));
  }

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ ${published} stories publicados com sucesso!`);
  log(`   Tema: ${dayPlan?.story?.topic || 'N/A'}`);
  log('═══════════════════════════════════════════');

  await notifyStory('new', published, dateStr);
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('story-publisher-new.cjs', err.message);
  process.exit(1);
});
