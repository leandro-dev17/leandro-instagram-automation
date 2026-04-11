/**
 * kling-publisher.cjs — Publica Reel Kling no Instagram
 *
 * Pipeline:
 *   1. Lê reel_kling do plano do dia (video_id + caption + hashtags)
 *   2. Copia o vídeo do pool para temp
 *   3. Gera hook provocativo via Claude (3-4 frases curtas para queimar no vídeo)
 *   4. Queima o hook no vídeo via ffmpeg drawtext (texto aparece e some a cada 2.5s)
 *   5. Faz upload para Cloudinary
 *   6. Publica como Reel no Instagram
 *   7. Publica no YouTube Shorts
 *   8. Notifica Telegram
 *
 * Uso: node kling-publisher.cjs [YYYY-MM-DD]
 */

'use strict';

const fs             = require('fs');
const path           = require('path');
const { execSync }   = require('child_process');

// ── Carrega .env ────────────────────────────────────────────────────────────────
(function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) {
      process.env[k.trim()] = v.join('=').trim();
    }
  }
})();

const { uploadVideo }                             = require('./lib/cloudinary.cjs');
const { publishReel, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { publishShort }                            = require('./lib/youtube.cjs');
const { notifyReel, notifyError }                 = require('./lib/telegram.cjs');

const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const LOGS_DIR     = path.join(__dirname, 'logs');
const POOL_DIR     = path.join(__dirname, 'kling-pool');
const TEMP_DIR     = process.env.TEMP_DIR ||
  (process.platform === 'win32'
    ? path.join(__dirname, 'temp')   // Windows local: usa automation/temp já existente
    : '/tmp/bionexus_render');       // Linux CI: pasta padrão

// ── Pool de vídeos aprovados ────────────────────────────────────────────────────
const VIDEO_POOL = [
  { id: '01-caminhada-camera-lateral',    file: '01-caminhada-camera-lateral.mp4',    tags: ['cardio','emagrecer','metabolismo','queima','gordura','caminhada'] },
  { id: '02-rotacao-360-luz-dourada',     file: '02-rotacao-360-luz-dourada.mp4',     tags: ['glúteo','gluteo','coxa','perna','bumbum','leg','quadril'] },
  { id: '03-close-rosto-sorriso',         file: '03-close-rosto-sorriso.mp4',         tags: ['motivação','motivacao','mindset','nutrição','nutricao','proteína','proteina','dica','alimentação'] },
  { id: '04-cintura-quadril-movimento',   file: '04-cintura-quadril-movimento.mp4',   tags: ['abdômen','abdomen','cintura','core','hormônio','hormonio','ciclo','feminino'] },
  { id: '05-camera-baixo-para-cima',      file: '05-camera-baixo-para-cima.mp4',      tags: ['força','forca','músculo','musculo','braço','braco','superação','superacao','intensidade'] },
  { id: '06-pernas-andando-close',        file: '06-pernas-andando-close.mp4',        tags: ['perna','panturrilha','cardio','passos'] },
  { id: '09-morena-clara-shoulder-press', file: '09-morena-clara-shoulder-press.mp4', tags: ['ombro','postura','superior','bíceps','biceps','rosca','press'] },
];

// ── Utilitários ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'kling-publisher.log'), line + '\n');
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

function resolveVideoPath(videoId) {
  const entry = VIDEO_POOL.find(v => v.id === videoId);
  if (!entry) throw new Error(`video_id desconhecido no pool: ${videoId}`);
  const p = path.join(POOL_DIR, entry.file);
  if (!fs.existsSync(p)) {
    throw new Error(`Vídeo não encontrado no pool: ${p}\nVerifique se os vídeos aprovados foram copiados para kling-pool/`);
  }
  return p;
}

function savePublished(dateStr, data) {
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  let tracking = {};
  if (fs.existsSync(trackingFile)) {
    try { tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch {}
  }
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr]['kling-reel'] = { ...data, publishedAt: new Date().toISOString() };
  fs.writeFileSync(trackingFile, JSON.stringify(tracking, null, 2));
}

// ── Gerador de hook provocativo via Claude ──────────────────────────────────────
async function generateHook(topic, caption) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você cria textos para queimar diretamente em vídeos curtos do Instagram (Reels) de @leandro_personall, personal trainer feminina.

O texto vai aparecer e sumir durante o vídeo de 10 segundos — são 4 frases curtas, cada uma aparecendo por ~2.5 segundos.

Tema do vídeo: "${topic}"
Contexto da caption: "${(caption || '').slice(0, 150)}"

ESTILO OBRIGATÓRIO — alterne entre estes dois estilos (escolha o mais impactante para o tema):

Estilo 1 — Provocação social + julgamento:
  "Ombro redondo não é genética."
  "É descuido."
  "Esse movimento resolve."
  "ou você continua inventando desculpa"

Estilo 2 — Rivalidade + nós contra eles:
  "Seu personal nunca te mostrou isso."
  "Porque é simples demais."
  "E simples não vende pacote de 3 meses."
  "Pensa nisso."

REGRAS CRÍTICAS:
- EXATAMENTE 4 frases
- Cada frase: máximo 40 caracteres (vai ser exibida em vídeo vertical)
- Tom: provocativo, levemente arrogante, divide opiniões
- SEM emojis (não renderizam corretamente no ffmpeg)
- SEM hashtags
- SEM perguntas diretas (afirmações são mais impactantes)
- NÃO use "Comenta", "Curte", "Salva" — isso é o que TODOS fazem
- A última frase deve ser levemente irônica ou desafiadora

Responda APENAS com JSON válido:
{
  "linha1": "frase 1 aqui",
  "linha2": "frase 2 aqui",
  "linha3": "frase 3 aqui",
  "linha4": "frase 4 aqui"
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    messages: [{ role: 'user', content: prompt }]
  });

  const text  = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido para o hook');
  const parsed = JSON.parse(match[0]);

  return [
    parsed.linha1 || '',
    parsed.linha2 || '',
    parsed.linha3 || '',
    parsed.linha4 || ''
  ].filter(Boolean);
}

// ── Queima hook no vídeo via ffmpeg drawtext ────────────────────────────────────

// ffmpeg drawtext exige que colons em caminhos Windows sejam escapados como \:
function escapeDrawtextPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
}

function burnHookText(inputMp4, outputMp4, hookLines) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  // Fonte: Arial Bold no Windows, DejaVu Bold no Linux (ambas suportam português)
  const rawFontPath = process.platform === 'win32'
    ? 'C:/Windows/Fonts/arialbd.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const fontPath = escapeDrawtextPath(rawFontPath);

  const segDuration = (10 / hookLines.length).toFixed(3);

  // Escreve cada linha em arquivo temporário para lidar corretamente com UTF-8
  const textFiles = hookLines.map((line, i) => {
    const f = path.join(TEMP_DIR, `kling-hook-${Date.now()}-${i}.txt`);
    fs.writeFileSync(f, line, 'utf8');
    return f;
  });

  // Monta filtros drawtext — cada segmento aparece no topo do vídeo (y=h*0.13)
  const drawFilters = hookLines.map((_, i) => {
    const start = (i * parseFloat(segDuration)).toFixed(2);
    const end   = ((i + 1) * parseFloat(segDuration)).toFixed(2);
    const safeTextFile = escapeDrawtextPath(textFiles[i]);
    return [
      `drawtext=fontfile='${fontPath}'`,
      `textfile='${safeTextFile}'`,
      `x=(w-text_w)/2`,
      `y=h*0.13`,
      `fontsize=54`,
      `fontcolor=white`,
      `box=1`,
      `boxcolor=black@0.55`,
      `boxborderw=20`,
      `enable='between(t,${start},${end})'`
    ].join(':');
  });

  const vf = drawFilters.join(',');

  try {
    execSync(
      `ffmpeg -y -i "${inputMp4}" -vf "${vf}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outputMp4}"`,
      { stdio: 'inherit' }
    );
  } finally {
    textFiles.forEach(f => { try { fs.unlinkSync(f); } catch {} });
  }
}

// ── MAIN ────────────────────────────────────────────────────────────────────────
async function main() {
  const dateStr = today();

  log('═══════════════════════════════════════════');
  log(`Kling Reel Publisher — ${dateStr}`);
  log('═══════════════════════════════════════════');

  // 1. Carrega plano do dia
  const dayPlan = findDayPlan(dateStr);
  if (!dayPlan) {
    const err = `Nenhum cronograma encontrado para ${dateStr}. Execute weekly-planner.cjs.`;
    log(`ERRO: ${err}`);
    await notifyError('kling-publisher.cjs', err);
    process.exit(1);
  }

  const reelKling = dayPlan.reel_kling;
  if (!reelKling || !reelKling.video_id) {
    const err = `Campo reel_kling não encontrado no plano de ${dateStr}. Regenere o cronograma.`;
    log(`ERRO: ${err}`);
    await notifyError('kling-publisher.cjs', err);
    process.exit(1);
  }

  log(`Tema: ${reelKling.topic}`);
  log(`Vídeo: ${reelKling.video_id}`);

  // 2. Localiza vídeo no pool
  const poolVideoPath = resolveVideoPath(reelKling.video_id);
  log(`Pool: ${poolVideoPath}`);

  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  // 3. Gera hook provocativo via Claude
  log('\n✍️  Gerando hook provocativo via Claude...');
  let hookLines;
  try {
    hookLines = await generateHook(reelKling.topic, reelKling.caption);
    log('  Hook gerado:');
    hookLines.forEach((l, i) => log(`    [${i + 1}] "${l}"`));
  } catch (err) {
    log(`  ⚠ Claude falhou para hook (${err.message}) — usando fallback genérico`);
    hookLines = [
      'Isso vai mudar seu treino.',
      'A maioria ignora.',
      'Os resultados provam.',
      'Continua como esta, entao.'
    ];
  }

  // 4. Queima hook no vídeo via ffmpeg
  const outputMp4 = path.join(TEMP_DIR, `kling-reel-${dateStr}-${Date.now()}.mp4`);
  log('\n🎬 Queimando hook no vídeo via ffmpeg...');
  burnHookText(poolVideoPath, outputMp4, hookLines);
  const sizeMb = (fs.statSync(outputMp4).size / 1024 / 1024).toFixed(1);
  log(`  ✅ Vídeo com hook: ${path.basename(outputMp4)} (${sizeMb} MB)`);

  // 5. Carrega credenciais Instagram
  const env   = loadEnv();
  const token = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // 6. Upload para Cloudinary
  log('\n📤 Upload para Cloudinary...');
  const videoUrl = await uploadVideo(outputMp4);
  log(`  ✅ URL: ${videoUrl}`);

  // 7. Monta caption final
  const caption = [
    reelKling.caption || '',
    '',
    reelKling.hashtags || '',
    '',
    'Segue @leandro_personall para mais dicas de treino feminino! 💪'
  ].join('\n').trim();

  // 8. Publica no Instagram como Reel
  log('\n📱 Publicando Reel no Instagram...');
  const postId = await publishReel(videoUrl, caption, token, userId);
  log(`  ✅ Instagram ID: ${postId}`);

  // 9. Publica no YouTube Shorts
  let youtubeId = null;
  if (env.YOUTUBE_REFRESH_TOKEN) {
    log('\n▶️  Publicando no YouTube Shorts...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const ytTitle = `${reelKling.topic} #Shorts`;
        youtubeId = await publishShort(videoUrl, ytTitle, caption);
        log(`  ✅ YouTube ID: ${youtubeId}`);
        break;
      } catch (err) {
        if (attempt < 3) {
          log(`  ⚠ YouTube tentativa ${attempt}/3 falhou: ${err.message} — aguardando 10s...`);
          await new Promise(r => setTimeout(r, 10000));
        } else {
          log(`  ⚠ YouTube falhou após 3 tentativas (Instagram OK): ${err.message}`);
        }
      }
    }
  } else {
    log('  ⚠ YOUTUBE_REFRESH_TOKEN não configurado — pulando YouTube.');
  }

  // 10. Notificação Telegram
  await notifyReel('kling', reelKling.topic, postId, dateStr, youtubeId);

  // 11. Rastreamento
  savePublished(dateStr, {
    postId,
    youtubeId,
    type: 'kling-reel',
    topic: reelKling.topic,
    videoId: reelKling.video_id,
    hook: hookLines
  });

  // 12. Limpa MP4 temporário
  try { fs.unlinkSync(outputMp4); } catch {}

  log('');
  log('═══════════════════════════════════════════');
  log('✅ REEL KLING PUBLICADO!');
  log(`   📱 Instagram ID: ${postId}`);
  if (youtubeId) log(`   ▶️  YouTube ID:   ${youtubeId}`);
  log(`   Tema: ${reelKling.topic}`);
  log(`   Vídeo: ${reelKling.video_id}`);
  log(`   Hook: "${hookLines[0]}" → "${hookLines[hookLines.length - 1]}"`);
  log('═══════════════════════════════════════════');
}

main().catch(async err => {
  console.error(`\n💥 ERRO FATAL: ${err.message}`);
  console.error(err.stack);
  try { await notifyError('kling-publisher.cjs', err.message); } catch {}
  process.exit(1);
});
