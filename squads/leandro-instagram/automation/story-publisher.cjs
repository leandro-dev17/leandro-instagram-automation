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
const { generateImage } = require('./lib/kie.cjs');

// Carrega variáveis do .env manualmente
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

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Gera conteúdo informativo e persuasivo para story via Claude
async function generateStoryContent(postData, storyLabel) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você é especialista em copywriting para Instagram Stories de @leandro_personall, personal trainer feminino focada em emagrecimento metabólico e treino por ciclo menstrual.

Tema do story: "${postData.headline || postData.title || storyLabel}"
Tipo: ${postData.type || storyLabel}
Contexto adicional: ${postData.body || postData.caption || ''}

Crie conteúdo para um Story do Instagram que seja MUITO atraente, informativo e persuasivo.
O story deve fazer a pessoa PARAR de passar o dedo e querer ler tudo.

Responda APENAS com JSON válido:

{
  "hook": "Headline impactante (máx 8 palavras, use números ou provocação — ex: '3 erros que sabotam seu treino')",
  "subhook": "Frase curta que reforça o gancho (máx 12 palavras, desperta curiosidade)",
  "points": [
    "Ponto informativo 1 — direto e prático (máx 10 palavras)",
    "Ponto informativo 2 — direto e prático (máx 10 palavras)",
    "Ponto informativo 3 — direto e prático (máx 10 palavras)"
  ],
  "cta": "Chamada para ação curta e enérgica (máx 7 palavras, ex: '💬 Me conta nos comentários!')"
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido para story');
  return JSON.parse(match[0]);
}

const LOGS_DIR     = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';

// Mapeamento: story number → post JSON e imagem de background
// Usa foto bruta (sem texto) como fundo do story
const STORY_MAP = {
  1: { postKey: 'post_1', bgPng: 'post-1-raw.png', label: 'Motivacional' },
  2: { postKey: 'post_2', bgPng: 'post-2-raw.png', label: 'Educativo' },
  3: { postKey: 'post_3', bgPng: 'post-3-raw.png', label: 'Científico' }
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

  // Verifica se já foi publicado hoje
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  if (fs.existsSync(trackingFile)) {
    try {
      const tracking = JSON.parse(fs.readFileSync(trackingFile, 'utf8'));
      if (tracking[dateStr] && tracking[dateStr][`story-${storyNumber}`]) {
        const existing = tracking[dateStr][`story-${storyNumber}`];
        log(`⚠️  Story ${storyNumber} já publicado hoje às ${existing.publishedAt} (ID: ${existing.postId})`);
        log(`   Pulando para evitar duplicata.`);
        process.exit(0);
      }
    } catch {}
  }

  const outDir  = path.join(ONEDRIVE_DIR, dateStr);

  // PNG do story dedicado (1080x1920)
  const storyPngName = `story-${storyNumber}-${label.toLowerCase()}.png`;
  let pngPath = path.join(outDir, storyPngName);

  // Se ainda não existe, gera a partir do schedule JSON + imagem de background
  if (!fs.existsSync(pngPath)) {
    log(`Story PNG não encontrado, gerando: ${storyPngName}`);
    let bgPath = path.join(outDir, bgPng);
    if (!fs.existsSync(bgPath)) {
      log(`⚠️  Background PNG não encontrado: ${bgPng} — gerando imagem via Kie.ai...`);
      ensureDir(outDir);
      const safePrompt = `Brazilian female personal trainer in her late 20s, lean athletic body, ${label.toLowerCase()} fitness content, standing confidently in bright modern gym with large windows, wearing colorful athletic outfit, smiling naturally, warm natural lighting, ultra photorealistic`;
      try {
        await generateImage(safePrompt, bgPath);
        log(`✅ Background gerado: ${bgPng}`);
      } catch (imgErr) {
        const err = `Falha ao gerar background para story: ${imgErr.message}`;
        log(`ERRO: ${err}`);
        await notifyError('story-publisher.cjs', err);
        process.exit(1);
      }
    }

    // Tenta carregar dados do post do schedule JSON
    let postData = { type: label.toLowerCase(), headline: label, body: '', cta: '💬 Comenta abaixo!', accent: '' };
    const scheduleDir = path.join(__dirname, 'schedule');
    const scheduleFiles = fs.readdirSync(scheduleDir)
      .filter(f => f.endsWith('.json')).sort().reverse();
    for (const sf of scheduleFiles) {
      try {
        const schedule = JSON.parse(fs.readFileSync(path.join(scheduleDir, sf), 'utf8'));
        const dayData = schedule.days && schedule.days[dateStr];
        if (dayData) {
          const postIndex = storyNumber - 1;
          if (dayData.posts && dayData.posts[postIndex]) {
            postData = { ...postData, ...dayData.posts[postIndex] };
          }
          break;
        }
      } catch (e) {
        log(`Aviso: não foi possível ler ${sf} — ${e.message}`);
      }
    }

    // Gera conteúdo informativo e persuasivo via Claude
    log('✍️  Gerando conteúdo do story via Claude...');
    try {
      const storyContent = await generateStoryContent(postData, label);
      postData = { ...postData, ...storyContent };
      log('✅ Conteúdo do story gerado');
    } catch (err) {
      log(`⚠️  Claude falhou, usando fallback: ${err.message}`);
      postData.hook     = postData.headline || label;
      postData.subhook  = 'Você precisa saber disso para o seu treino!';
      postData.points   = ['Consistência é mais importante que intensidade', 'Ciclo menstrual afeta diretamente seus resultados', 'Nutrição certa potencializa cada treino'];
      postData.cta      = '💬 Qual dica te surpreendeu mais?';
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
  savePublished(dateStr, storyNumber, { postId, type: 'story', label, image: storyPngName });
}

main().catch(async err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  await notifyError('story-publisher.cjs', err.message);
  process.exit(1);
});
