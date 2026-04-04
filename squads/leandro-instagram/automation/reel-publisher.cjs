/**
 * reel-publisher.cjs — Publica um Reel automaticamente no Instagram
 *
 * Uso: node reel-publisher.cjs <numero> [data]
 *   numero: 1 a 5 (reels do dia) ou 6 (reel-dica)
 *   data (opcional): YYYY-MM-DD — padrão: hoje
 *
 * Horários automáticos (Task Scheduler):
 *   Reel 1 → 09:00h
 *   Reel 2 → 11:00h
 *   Reel 3 → 13:00h
 *   Reel 4 → 16:00h
 *   Reel 5 → 20:00h
 *   Reel Dica → 14:00h
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { pngToMp4 }             = require('./lib/ffmpeg.cjs');
const { uploadVideo, uploadImage } = require('./lib/cloudinary.cjs');
const { publishReel, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { notifyReel, notifyError } = require('./lib/telegram.cjs');

const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const TEMP_DIR     = 'C:/bionexus_render_tmp';

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'reel-publisher.log'), line + '\n');
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

function savePublished(dateStr, reelNumber, data) {
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try { tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch {}
  }
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr][`reel-${reelNumber}`] = { ...data, publishedAt: new Date().toISOString() };
  fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
}

async function main() {
  const reelNumber = parseInt(process.argv[2]);
  if (!reelNumber || reelNumber < 1 || reelNumber > 6) {
    console.error('Uso: node reel-publisher.cjs <1-5|6> [YYYY-MM-DD]');
    console.error('  1-5 = reels do dia | 6 = reel dica do personal');
    process.exit(1);
  }

  const dateStr   = today();
  const isDica    = reelNumber === 6;
  const pngName   = isDica ? 'reel-dica.png' : `reel-0${reelNumber}.png`;
  const label     = isDica ? 'Dica do Personal' : `Reel ${reelNumber}`;

  log('═══════════════════════════════════════════');
  log(`Instagram Reel Publisher — ${label}`);
  log(`Data: ${dateStr}`);
  log('═══════════════════════════════════════════');

  // Carrega plano do dia (para caption/hashtags)
  const dayPlan = findDayPlan(dateStr);
  if (!dayPlan) {
    const err = `Nenhum cronograma para ${dateStr}. Execute weekly-planner.cjs.`;
    log(`ERRO: ${err}`);
    await notifyError('reel-publisher.cjs', err);
    process.exit(1);
  }

  // Busca dados do reel no schedule
  let caption = '';
  let headline = '';
  let hashtags = dayPlan.reels_hashtags || '';

  if (isDica) {
    const dica = dayPlan.dica_receita;
    headline = dica?.title || 'Dica do Personal';
    caption  = `${dica?.caption || ''}\n\n${dica?.hashtags || hashtags}`;
  } else {
    const reel = dayPlan.reels?.[reelNumber - 1];
    headline = reel?.headline || `Reel ${reelNumber}`;
    caption  = `${reel?.cta || ''}\n\n${hashtags}`;
  }

  // Encontra o PNG
  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  const pngPath = path.join(outDir, pngName);
  if (!fs.existsSync(pngPath)) {
    const err = `PNG não encontrado: ${pngPath}`;
    log(`ERRO: ${err}`);
    await notifyError('reel-publisher.cjs', err);
    process.exit(1);
  }
  log(`PNG: ${pngName}`);

  // Converte PNG → MP4
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const mp4Name = pngName.replace('.png', `-${Date.now()}.mp4`);
  const mp4Path = path.join(TEMP_DIR, mp4Name);

  log('🎬 Convertendo PNG → MP4 (6 segundos)...');
  pngToMp4(pngPath, mp4Path, 6);
  log(`✅ MP4 gerado: ${mp4Name}`);

  // Carrega credenciais
  const env   = loadEnv();
  const token = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // Upload para Cloudinary
  log('');
  log('📤 Fazendo upload do vídeo para Cloudinary...');
  const videoUrl = await uploadVideo(mp4Path);
  log(`✅ URL vídeo: ${videoUrl}`);

  log('🖼️  Fazendo upload da capa PNG para Cloudinary...');
  const coverUrl = await uploadImage(pngPath);
  log(`✅ URL capa: ${coverUrl}`);

  // Publica como Reel no Instagram
  log('');
  log('🎬 Publicando Reel no Instagram...');
  const postId = await publishReel(videoUrl, caption, token, userId, coverUrl);

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ ${label.toUpperCase()} PUBLICADO COM SUCESSO!`);
  log(`   Instagram Post ID: ${postId}`);
  log(`   Headline: ${headline}`);
  log('═══════════════════════════════════════════');

  // Notifica Telegram
  await notifyReel(reelNumber, headline, postId, dateStr);

  // Salva rastreamento
  savePublished(dateStr, reelNumber, { postId, type: isDica ? 'dica' : 'reel', headline, image: pngName });

  // Limpa MP4 temporário
  try { fs.unlinkSync(mp4Path); } catch {}
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('reel-publisher.cjs', err.message);
  process.exit(1);
});
