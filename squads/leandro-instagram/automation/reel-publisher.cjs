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

const { pngToMp4, slidesToMp4 } = require('./lib/ffmpeg.cjs');
const { uploadVideo, uploadImage } = require('./lib/cloudinary.cjs');
const { publishReel, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { publishShort } = require('./lib/youtube.cjs');
const { notifyReel, notifyError } = require('./lib/telegram.cjs');

const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const TEMP_DIR     = process.env.TEMP_DIR || (process.platform === 'win32' ? 'C:/bionexus_render_tmp' : '/tmp/bionexus_render');

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

// Gera legenda específica por tema via Claude
async function generateCaption(reel) {
  // Carrega .env manualmente
  const envPath = path.join(__dirname, '../.env');
  const envLines = fs.readFileSync(envPath, 'utf8').split('\n');
  let anthropicKey = '';
  for (const line of envLines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() === 'ANTHROPIC_API_KEY') { anthropicKey = v.join('=').trim(); break; }
  }

  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: anthropicKey });

  const prompt = `Você é especialista em conteúdo fitness para Instagram de @leandro_personall, personal trainer feminino.

Tema do reel: "${reel.headline}"
Tipo: ${reel.type}

Gere a legenda completa para publicação. Responda APENAS com JSON válido:

{
  "caption": "Texto de 3 a 5 linhas sobre o tema, conversacional, com gancho no início e que gere engajamento. Inclua uma pergunta ao público no final.",
  "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5",
  "cta": "Segue @leandro_personall para mais dicas de treino feminino! 💪"
}

Regras:
- Caption em português brasileiro, tom próximo e motivador
- Hashtags específicas para o tema (não genéricas)
- CTA sempre chamando para seguir o perfil`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido para caption');
  return JSON.parse(match[0]);
}

async function main() {
  const reelNumber = parseInt(process.argv[2]);
  if (!reelNumber || reelNumber < 1 || reelNumber > 6) {
    console.error('Uso: node reel-publisher.cjs <1-5|6> [YYYY-MM-DD]');
    console.error('  1-5 = reels do dia | 6 = reel dica do personal');
    process.exit(1);
  }

  const dateStr = today();
  const isDica  = reelNumber === 6;
  const label   = isDica ? 'Dica do Personal' : `Reel ${reelNumber}`;

  log('═══════════════════════════════════════════');
  log(`Instagram Reel Publisher — ${label}`);
  log(`Data: ${dateStr}`);
  log('═══════════════════════════════════════════');

  // Carrega plano do dia
  const dayPlan = findDayPlan(dateStr);
  if (!dayPlan) {
    const err = `Nenhum cronograma para ${dateStr}. Execute weekly-planner.cjs.`;
    log(`ERRO: ${err}`);
    await notifyError('reel-publisher.cjs', err);
    process.exit(1);
  }

  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  let caption = '';
  let headline = '';
  let mp4Path = '';

  if (isDica) {
    // ── Reel Dica do Personal — lógica original intacta ──
    const dica = dayPlan.dica_receita;
    headline   = dica?.title || 'Dica do Personal';
    caption    = `${dica?.caption || ''}\n\n${dica?.hashtags || dayPlan.reels_hashtags || ''}`;

    const pngName = 'reel-dica.png';
    const pngPath = path.join(outDir, pngName);
    if (!fs.existsSync(pngPath)) {
      const err = `PNG não encontrado: ${pngPath}`;
      log(`ERRO: ${err}`); await notifyError('reel-publisher.cjs', err); process.exit(1);
    }
    log(`PNG: ${pngName}`);
    mp4Path = path.join(TEMP_DIR, `reel-dica-${Date.now()}.mp4`);
    log('🎬 Convertendo PNG → MP4 (6 segundos)...');
    pngToMp4(pngPath, mp4Path, 6);

  } else {
    // ── Reels normais — 4 slides → MP4 ──
    const reelNum = `0${reelNumber}`;
    const reel    = dayPlan.reels?.[reelNumber - 1];
    headline      = reel?.headline || `Reel ${reelNumber}`;

    // Verifica os 4 slides
    const slidePaths = [1, 2, 3, 4].map(s =>
      path.join(outDir, `reel-${reelNum}-slide${s}.png`)
    );
    for (const sp of slidePaths) {
      if (!fs.existsSync(sp)) {
        const err = `Slide não encontrado: ${sp}`;
        log(`ERRO: ${err}`); await notifyError('reel-publisher.cjs', err); process.exit(1);
      }
    }
    log(`Slides: ${slidePaths.map(p => path.basename(p)).join(', ')}`);

    // Converte 4 slides → MP4 (5s por slide = 20s total)
    mp4Path = path.join(TEMP_DIR, `reel-${reelNum}-${Date.now()}.mp4`);
    log('🎬 Convertendo 4 slides → MP4 (5s cada = 20s total)...');
    slidesToMp4(slidePaths, mp4Path, 5);

    // Gera legenda específica via Claude
    log('✍️  Gerando legenda específica via Claude...');
    try {
      const captionData = await generateCaption(reel);
      caption = `${captionData.caption}\n\n${captionData.hashtags}\n\n${captionData.cta}`;
      log(`✅ Legenda gerada`);
    } catch (err) {
      log(`  → Claude falhou para legenda, usando fallback: ${err.message}`);
      caption = `${reel?.cta || ''}\n\n${dayPlan.reels_hashtags || ''}\n\nSegue @leandro_personall para mais dicas! 💪`;
    }
  }

  log(`✅ MP4 gerado: ${path.basename(mp4Path)}`);

  // Carrega credenciais
  const env   = loadEnv();
  const token = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // Upload para Cloudinary
  log('');
  log('📤 Fazendo upload do vídeo para Cloudinary...');
  const videoUrl = await uploadVideo(mp4Path);
  log(`✅ URL vídeo: ${videoUrl}`);

  // Capa: para dica usa o PNG único; para reels normais usa slide 1
  const coverPng = isDica
    ? path.join(outDir, 'reel-dica.png')
    : path.join(outDir, `reel-0${reelNumber}-slide1.png`);

  log('🖼️  Fazendo upload da capa PNG para Cloudinary...');
  const coverUrl = await uploadImage(coverPng);
  log(`✅ URL capa: ${coverUrl}`);

  // ── Publica no Instagram ──────────────────────────────────────────────────
  log('');
  log('📱 Publicando Reel no Instagram...');
  const postId = await publishReel(videoUrl, caption, token, userId, coverUrl);
  log(`✅ Instagram: ${postId}`);

  // ── Publica no YouTube Shorts ─────────────────────────────────────────────
  let youtubeId = null;
  const ytEnv = loadEnv();
  if (ytEnv.YOUTUBE_REFRESH_TOKEN) {
    log('');
    log('▶️  Publicando no YouTube Shorts...');
    try {
      const ytTitle = `${headline} #Shorts`;
      youtubeId = await publishShort(videoUrl, ytTitle, caption);
      log(`✅ YouTube: ${youtubeId}`);
    } catch (err) {
      log(`⚠️  YouTube falhou (Instagram OK): ${err.message}`);
    }
  } else {
    log('  ⚠ YOUTUBE_REFRESH_TOKEN não configurado — pulando YouTube.');
  }

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ ${label.toUpperCase()} PUBLICADO!`);
  log(`   📱 Instagram ID: ${postId}`);
  if (youtubeId) log(`   ▶️  YouTube ID:   ${youtubeId}`);
  log(`   Headline: ${headline}`);
  log('═══════════════════════════════════════════');

  // Notifica Telegram
  await notifyReel(reelNumber, headline, postId, dateStr, youtubeId);

  // Salva rastreamento
  const imgRef = isDica ? 'reel-dica.png' : `reel-0${reelNumber}-slide1.png`;
  savePublished(dateStr, reelNumber, { postId, youtubeId, type: isDica ? 'dica' : 'reel', headline, image: imgRef });

  // Limpa MP4 temporário
  try { fs.unlinkSync(mp4Path); } catch {}
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('reel-publisher.cjs', err.message);
  process.exit(1);
});
