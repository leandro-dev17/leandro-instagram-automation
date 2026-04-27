/**
 * story-publisher-new.cjs — Publica Story de vídeo no Instagram
 *
 * Combina story-slide1.png até story-slide5.png em um único MP4 (20 segundos)
 * usando ffmpeg (4s por slide), faz upload para Cloudinary e publica
 * como 1 Story de vídeo no Instagram.
 *
 * Uso: node story-publisher-new.cjs [data]
 *   data (opcional): YYYY-MM-DD — padrão: hoje
 *
 * Horário automático (GitHub Actions / Task Scheduler): 07:00h
 */

'use strict';

const fs         = require('fs');
const path       = require('path');
const { execSync } = require('child_process');

// Carrega .env
(function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) process.env[k.trim()] = v.join('=').trim();
  }
})();

const { uploadVideo }                                          = require('./lib/cloudinary.cjs');
const { publishVideoStory, refreshTokenIfNeeded, loadEnv }    = require('./lib/instagram.cjs');
const { notifyStory, notifyError }                            = require('./lib/telegram.cjs');

const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const TEMP_DIR     = process.env.TEMP_DIR || (process.platform === 'win32' ? 'C:/bionexus_render_tmp' : '/tmp/bionexus_render');
const TOTAL_SLIDES = 5;
const SECS_PER_SLIDE = 3; // 5 slides × 3s = 15s total (Instagram divide vídeos acima de 15s em 2 segmentos)

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

function findDayPlan(dateStr) {
  if (!fs.existsSync(SCHEDULE_DIR)) return null;
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files.sort().reverse()) {
    const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
    if (plan.days && plan.days[dateStr]) return plan.days[dateStr];
  }
  return null;
}

/**
 * Combina os 5 slides PNG em um único MP4 usando ffmpeg.
 * Cada slide é exibido por SECS_PER_SLIDE segundos.
 */
function buildMp4(slidePaths, outputMp4) {
  // Usa TEMP_DIR para o concat e MP4 — evita espaços/ã no caminho passado ao ffmpeg
  // Aspas simples no concat file (ffmpeg 8.1+ não aceita aspas duplas)
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const ts         = Date.now();
  const concatFile = path.join(TEMP_DIR, `story-concat-${ts}.txt`).replace(/\\/g, '/');
  const tempMp4    = path.join(TEMP_DIR, `story-${ts}.mp4`).replace(/\\/g, '/');

  const normPath = p => p.replace(/\\/g, '/');
  const lines = slidePaths.map(p => `file '${normPath(p)}'\nduration ${SECS_PER_SLIDE}`);
  lines.push(`file '${normPath(slidePaths[slidePaths.length - 1])}'`);
  fs.writeFileSync(concatFile, lines.join('\n') + '\n', 'utf8');

  const cmd = [
    'ffmpeg -y',
    `-f concat -safe 0 -i ${concatFile}`,
    '-c:v libx264 -pix_fmt yuv420p -r 30',
    '-movflags +faststart',
    tempMp4
  ].join(' ');

  log(`  🎬 ffmpeg: ${cmd}`);
  try {
    execSync(cmd, { stdio: 'pipe' });
  } catch (err) {
    const detail = (err.stderr || err.stdout || err.message || '').toString().slice(-600);
    throw new Error(`ffmpeg falhou: ${detail}`);
  }

  fs.copyFileSync(tempMp4, outputMp4);
  try { fs.unlinkSync(concatFile); } catch {}
  try { fs.unlinkSync(tempMp4); } catch {}
}

async function main() {
  const dateStr = today();

  log('═══════════════════════════════════════════');
  log(`Story Publisher (vídeo) — ${TOTAL_SLIDES} slides → 1 MP4`);
  log(`Data: ${dateStr}`);
  log('═══════════════════════════════════════════');

  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  const slide1 = path.join(outDir, 'story-slide1.png');

  // Se slides não existem, roda o gerador automaticamente (fallback para quando PC dormia às 05h)
  if (!fs.existsSync(slide1)) {
    log('⚠️  Slides não encontrados — rodando daily-generator.cjs automaticamente...');
    const { execFileSync } = require('child_process');
    const generatorPath = require('path').join(__dirname, 'daily-generator.cjs');
    try {
      execFileSync(process.execPath, [generatorPath], { stdio: 'inherit', timeout: 15 * 60 * 1000 });
      log('✅ Gerador concluído. Continuando publicação...');
    } catch (err) {
      log(`ERRO FATAL: Gerador falhou: ${err.message}`);
      process.exit(1);
    }
  }

  // Verifica se já foi publicado
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try { tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch {}
  }
  if (tracking[dateStr] && tracking[dateStr]['story-video']) {
    const existing = tracking[dateStr]['story-video'];
    log(`⚠️  Story vídeo já publicado hoje às ${existing.publishedAt} (ID: ${existing.postId})`);
    log('   Pulando para evitar duplicata.');
    process.exit(0);
  }

  // Verifica existência de todos os slides
  const slidePaths = [];
  for (let n = 1; n <= TOTAL_SLIDES; n++) {
    const slidePath = path.join(outDir, `story-slide${n}.png`);
    if (!fs.existsSync(slidePath)) {
      log(`ERRO: story-slide${n}.png não encontrado após gerador: ${outDir}`);
      process.exit(1);
    }
    slidePaths.push(slidePath);
  }

  log(`✅ ${TOTAL_SLIDES} slides encontrados`);

  // Combina em MP4
  const outputMp4 = path.join(outDir, 'story.mp4');
  log('');
  log(`🎬 Combinando ${TOTAL_SLIDES} slides em MP4 (${TOTAL_SLIDES * SECS_PER_SLIDE}s)...`);
  buildMp4(slidePaths, outputMp4);

  const mp4Size = (fs.statSync(outputMp4).size / 1024 / 1024).toFixed(1);
  log(`✅ MP4 gerado: ${mp4Size} MB → ${outputMp4}`);

  // Upload para Cloudinary
  log('');
  log('📤 Fazendo upload do MP4 para Cloudinary...');
  const videoUrl = await uploadVideo(outputMp4);
  log(`✅ URL: ${videoUrl}`);

  // Publica no Instagram como Story de vídeo
  const env    = loadEnv();
  const token  = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  log('');
  log('📱 Publicando Story de vídeo no Instagram...');
  const postId = await publishVideoStory(videoUrl, token, userId);

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ STORY VÍDEO PUBLICADO COM SUCESSO!`);
  log(`   Instagram Post ID: ${postId}`);
  log(`   Slides: ${TOTAL_SLIDES} × ${SECS_PER_SLIDE}s = ${TOTAL_SLIDES * SECS_PER_SLIDE}s`);
  log('═══════════════════════════════════════════');

  // Notifica Telegram
  const dayPlan = findDayPlan(dateStr);
  await notifyStory('video', 1, dateStr);

  // Rastreamento
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr]['story-video'] = {
    postId,
    publishedAt: new Date().toISOString(),
    topic: dayPlan?.story?.topic || 'N/A',
    slides: TOTAL_SLIDES,
    duration: TOTAL_SLIDES * SECS_PER_SLIDE
  };
  // Mantém compatibilidade com keys antigas (story-new-1..5) para o dashboard
  for (let n = 1; n <= TOTAL_SLIDES; n++) {
    tracking[dateStr][`story-new-${n}`] = tracking[dateStr]['story-video'];
  }
  fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));

  // Limpa o MP4 temporário
  try { fs.unlinkSync(outputMp4); } catch {}
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('story-publisher-new.cjs', err.message);
  process.exit(1);
});
