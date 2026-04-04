/**
 * story-publisher.cjs — Publica Stories automáticos no Instagram
 *
 * Usa os posts do feed do dia como stories (3 stories por dia).
 * Horários automáticos (Task Scheduler):
 *   Story 1 (post motivacional) → 08:00h
 *   Story 2 (post educativo)    → 13:30h
 *   Story 3 (post científico)   → 19:00h
 *
 * Uso: node story-publisher.cjs <1|2|3> [data]
 */

const fs   = require('fs');
const path = require('path');

const { uploadImage }          = require('./lib/cloudinary.cjs');
const { publishStory, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { notifyStory, notifyError } = require('./lib/telegram.cjs');
const { storyPost, renderHTML } = require('./lib/renderer.cjs');

const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';

// Mapeamento: story number → post JSON e imagem de background
const STORY_MAP = {
  1: { postKey: 'post_1', bgPng: 'post-1-motivacional.png', label: 'Motivacional' },
  2: { postKey: 'post_2', bgPng: 'post-2-educativo.png',    label: 'Educativo' },
  3: { postKey: 'post_3', bgPng: 'post-3-cientifico.png',   label: 'Científico' }
};

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'story-publisher.log'), line + '\n');
}

function today() {
  const arg = process.argv[3];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  return new Date().toISOString().slice(0, 10);
}

function savePublished(dateStr, storyNumber, data) {
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try { tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch {}
  }
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr][`story-${storyNumber}`] = { ...data, publishedAt: new Date().toISOString() };
  fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
}

async function main() {
  const storyNumber = parseInt(process.argv[2]);
  if (!storyNumber || storyNumber < 1 || storyNumber > 3) {
    console.error('Uso: node story-publisher.cjs <1|2|3> [YYYY-MM-DD]');
    process.exit(1);
  }

  const dateStr = today();
  const { postKey, bgPng, label } = STORY_MAP[storyNumber];

  log('═══════════════════════════════════════════');
  log(`Instagram Story Publisher — Story ${storyNumber}: ${label}`);
  log(`Data: ${dateStr}`);
  log('═══════════════════════════════════════════');

  const outDir  = path.join(ONEDRIVE_DIR, dateStr);

  // PNG do story dedicado (1080x1920)
  const storyPngName = `story-${storyNumber}-${label.toLowerCase()}.png`;
  let pngPath = path.join(outDir, storyPngName);

  // Se ainda não existe, gera a partir do schedule JSON + imagem de background
  if (!fs.existsSync(pngPath)) {
    log(`Story PNG não encontrado, gerando: ${storyPngName}`);
    const bgPath = path.join(outDir, bgPng);
    if (!fs.existsSync(bgPath)) {
      const err = `Background PNG não encontrado: ${bgPath}`;
      log(`ERRO: ${err}`);
      await notifyError('story-publisher.cjs', err);
      process.exit(1);
    }

    // Tenta carregar dados do post do schedule JSON
    let postData = { type: label.toLowerCase(), headline: label, body: '', cta: '💬 Comenta abaixo!', accent: '' };
    const scheduleFiles = fs.readdirSync(path.join(__dirname, 'schedule'))
      .filter(f => f.endsWith('.json') && f.includes(dateStr));
    if (scheduleFiles.length > 0) {
      try {
        const schedule = JSON.parse(fs.readFileSync(path.join(__dirname, 'schedule', scheduleFiles[0]), 'utf8'));
        const dayData = schedule[dateStr] || Object.values(schedule)[0];
        if (dayData && dayData[postKey]) {
          postData = { ...postData, ...dayData[postKey] };
        }
      } catch (e) {
        log(`Aviso: não foi possível ler schedule JSON — usando dados padrão`);
      }
    }

    const html = storyPost(postData, bgPath);
    await renderHTML(html, pngPath, 1080, 1920);
    log(`✅ Story gerado: ${storyPngName}`);
  } else {
    log(`Imagem story existente: ${storyPngName}`);
  }

  log(`Imagem: ${storyPngName}`);

  // Carrega credenciais
  const env    = loadEnv();
  const token  = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // Upload para Cloudinary
  log('');
  log('📤 Fazendo upload para Cloudinary...');
  const imageUrl = await uploadImage(pngPath);
  log(`✅ URL pública: ${imageUrl}`);

  // Publica como Story
  log('');
  log('📸 Publicando Story no Instagram...');
  const postId = await publishStory(imageUrl, token, userId);

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ STORY ${storyNumber} PUBLICADO COM SUCESSO!`);
  log(`   Instagram Post ID: ${postId}`);
  log(`   Tipo: ${label}`);
  log('═══════════════════════════════════════════');

  // Notifica Telegram
  await notifyStory(storyNumber, postId, dateStr);

  // Salva rastreamento
  savePublished(dateStr, storyNumber, { postId, type: 'story', label, image: png });
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('story-publisher.cjs', err.message);
  process.exit(1);
});
