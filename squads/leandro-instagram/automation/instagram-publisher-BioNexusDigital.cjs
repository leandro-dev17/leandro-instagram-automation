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
const { publishPost, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');

const SCHEDULE_DIR   = path.join(__dirname, 'schedule');
const LOGS_DIR       = path.join(__dirname, 'logs');
const PUBLISHED_FILE = path.join(__dirname, 'logs', 'published-posts.json');
const ONEDRIVE_DIR   = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';

// ─── UTILIDADES ─────────────────────────────────────────────────────────────

function loadPublished() {
  if (!fs.existsSync(PUBLISHED_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(PUBLISHED_FILE, 'utf8')); } catch { return {}; }
}

function markPublished(dateStr, postIndex, postId) {
  const data = loadPublished();
  if (!data[dateStr]) data[dateStr] = {};
  data[dateStr][postIndex] = { postId, publishedAt: new Date().toISOString() };
  fs.writeFileSync(PUBLISHED_FILE, JSON.stringify(data, null, 2));
}

function isAlreadyPublished(dateStr, postIndex) {
  const data = loadPublished();
  return !!(data[dateStr] && data[dateStr][postIndex]);
}

async function withRetry(fn, label, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isTransient = /5\d\d/.test(err.message) || /ECONNRESET|ETIMEDOUT|ENOTFOUND/.test(err.message);
      if (isTransient && attempt < maxAttempts) {
        const waitSec = attempt * 30;
        log(`  ⚠ ${label} falhou (tentativa ${attempt}/${maxAttempts}): ${err.message}`);
        log(`  ↺ Aguardando ${waitSec}s antes de tentar novamente...`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
      } else {
        throw err;
      }
    }
  }
}

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

  // Carrega plano do dia
  const dayPlan = findDayPlan(dateStr);
  if (!dayPlan) {
    log(`ERRO: Nenhum cronograma para ${dateStr}. Execute weekly-planner.cjs.`);
    process.exit(1);
  }

  const post = dayPlan.posts[postIndex - 1];
  if (!post) {
    log(`ERRO: Post ${postIndex} não encontrado no cronograma de ${dateStr}`);
    process.exit(1);
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
  const imgFile = files.find(f => f.startsWith(`post-${postIndex}-`) && f.endsWith('.png'));
  if (!imgFile) {
    log(`ERRO: Imagem post-${postIndex}-*.png não encontrada em ${outDir}`);
    process.exit(1);
  }

  const imgPath = path.join(outDir, imgFile);
  log(`Imagem: ${imgFile}`);

  // Carrega credenciais e renova token se necessário
  const env = loadEnv();
  if (!env.INSTAGRAM_USER_ID) {
    log('ERRO: INSTAGRAM_USER_ID não configurado no .env');
    log('Siga o guia em INSTAGRAM-SETUP.md para configurar.');
    process.exit(1);
  }

  // Verifica se já foi publicado hoje
  if (isAlreadyPublished(dateStr, postIndex)) {
    const data = loadPublished();
    const prev = data[dateStr][postIndex];
    log(`⚠ Post ${postIndex} já foi publicado hoje às ${prev.publishedAt} (ID: ${prev.postId})`);
    log('  Abortando para evitar duplicata. Use --force para forçar.');
    if (!process.argv.includes('--force')) process.exit(0);
    log('  --force detectado, prosseguindo mesmo assim...');
  }

  const token = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // Upload para Cloudinary
  log('');
  log('📤 Fazendo upload para Cloudinary...');
  const imageUrl = await withRetry(() => uploadImage(imgPath), 'Cloudinary upload');
  log(`✅ URL pública: ${imageUrl}`);

  // Monta caption
  const caption = `${post.caption}\n\n${post.hashtags}`;
  log(`Caption: ${caption.slice(0, 80)}...`);

  // Publica no Instagram
  log('');
  log('📱 Publicando no Instagram...');
  const postId = await withRetry(() => publishPost(imageUrl, caption, token, userId), 'Instagram publish');

  markPublished(dateStr, postIndex, postId);

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ POST ${postIndex} PUBLICADO COM SUCESSO!`);
  log(`   Instagram Post ID: ${postId}`);
  log(`   Tipo: ${post.type}`);
  log(`   Imagem: ${imgFile}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
