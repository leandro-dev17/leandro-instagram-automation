/**
 * daily-generator.cjs
 * Roda automaticamente às 5h via Windows Task Scheduler.
 * Lê o cronograma da semana, gera imagens e posts do dia,
 * salva tudo na pasta do OneDrive.
 */

const fs = require('fs');
const path = require('path');

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

const { generateImage, generateFoodImage } = require('./lib/kie.cjs');
const { reelPost, recipeDicaReel, singlePost, renderHTML, reelSlide1Hook, reelSlide2Dev, reelSlide3Tip, reelSlide4CTA } = require('./lib/renderer.cjs');
const { generateSmartHTML } = require('./lib/claude-renderer.cjs');
const { getNextRecipe, getBankStatus } = require('./lib/recipe-manager.cjs');

const SQUAD_DIR   = path.join(__dirname, '..');
const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const LOGS_DIR    = path.join(__dirname, 'logs');
const ONEDRIVE_DIR = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const TEMP_DIR    = path.join(__dirname, 'temp');

// ─── UTILIDADES ────────────────────────────────────────────────────────────────

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOGS_DIR, 'generator.log'), line + '\n');
}

function today() {
  // Aceita data via argumento: node daily-generator.cjs 2026-03-28
  if (process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2])) {
    return process.argv[2];
  }
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// Encontra o JSON de cronograma válido para hoje
function findSchedule(dateStr) {
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files.sort().reverse()) {
    const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
    if (plan.days && plan.days[dateStr]) {
      return { file, plan };
    }
  }
  return null;
}

function buildPublicarMd(dateStr, dayPlan) {
  const d = dayPlan;
  const lines = [
    `# Conteúdo do dia — ${dateStr}`,
    `**Gerado automaticamente às 5h por BioNexus Digital**`,
    ``,
    `---`,
    ``,
    `## 🎬 REELS (5 imagens individuais — formato 9:16)`
  ];

  // Usa reels_hashtags se existir, senão pega as do primeiro reel (5 tags)
  const reelHashtags = d.reels_hashtags || (d.reels?.[0]?.hashtags || '');
  lines.push(``, `**📌 Hashtags (use as mesmas nos 5 reels — cole no 1º comentário de cada):**`);
  lines.push(reelHashtags, ``, `---`, ``);
  (d.reels || []).forEach((reel, i) => {
    lines.push(`### Reel ${i + 1} — ${reel.type || 'dica'}`);
    lines.push(`**Arquivo:** reel-0${i + 1}.png`, ``);
  });

  lines.push(``);


  d.posts.forEach((post, i) => {
    const label = { motivacional: 'MOTIVACIONAL', educativo: 'EDUCATIVO', cientifico: 'CIENTÍFICO', mitos: 'DESVENDANDO MITOS' };
    lines.push(`## POST ${i + 1} — ${label[post.type] || post.type.toUpperCase()}`);
    lines.push(`**Arquivo:** post-${i + 1}-${post.type}.png`);
    lines.push(``);
    lines.push(`### Caption`);
    lines.push(post.caption);
    lines.push(``);
    lines.push(`### Hashtags`);
    lines.push(post.hashtags);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  });

  // Dica do Personal
  if (d.dica_receita) {
    const r = d.dica_receita;
    lines.push(`## 🍽️ DICA DO PERSONAL — ${r.title}`);
    lines.push(`**Arquivo:** reel-dica.png`);
    lines.push(`**Categoria:** ${r.category || ''}`);
    lines.push(``);
    lines.push(`### Caption + Receita Completa`);
    lines.push(r.caption);
    lines.push(``);
    lines.push(`### Hashtags`);
    lines.push(r.hashtags);
    lines.push(``);
    lines.push(`---`);
    lines.push(``);
  }

  lines.push(`## ✅ Checklist`);
  lines.push(`- [ ] Reel 1: postar + colar 5 hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 2: postar + colar 5 hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 3: postar + colar 5 hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 4: postar + colar 5 hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 5: postar + colar 5 hashtags no 1º comentário`);
  lines.push(`- [ ] Post 1 (motivacional): postar no feed`);
  lines.push(`- [ ] Post 2 (educativo): postar no feed`);
  lines.push(`- [ ] Post 3 (científico/mitos): postar no feed`);
  lines.push(`- [ ] Responder comentários nas primeiras 2h`);
  lines.push(``);
  lines.push(`*Gerado por BioNexus Digital — @leandro_personall*`);

  return lines.join('\n');
}

// ─── GERADOR DE CONTEÚDO DOS SLIDES VIA CLAUDE ───────────────────────────────

async function generateSlideContent(reel) {
  const Anthropic = require('C:/Users/lelus/OneDrive/Pictures/BioNexus Digital/node_modules/@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você é especialista em conteúdo fitness para Instagram de @leandro_personall, personal trainer feminino focada em resultados reais para mulheres.

Tema do reel: "${reel.headline}"
Tipo: ${reel.type}

Gere os textos dos 4 slides deste reel em português, diretos e impactantes.
Responda APENAS com JSON válido, sem texto extra:

{
  "slide1": {
    "headline": "Pergunta ou gancho impactante (máx 8 palavras, use ? ou !)",
    "body": "Frase curta que desperta curiosidade (máx 12 palavras)"
  },
  "slide2": {
    "headline": "Título do desenvolvimento (máx 6 palavras)",
    "body": "Explicação clara e prática do tema (máx 30 palavras)"
  },
  "slide3": {
    "headline": "A Dica Principal:",
    "body": "Dica prática e acionável sobre o tema (máx 25 palavras, use verbos de ação)"
  },
  "slide4": {
    "headline": "Quer mais dicas assim?",
    "body": "Segue @leandro_personall e ativa as notificações para não perder nenhum treino!"
  }
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 600,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido para slides');
  return JSON.parse(match[0]);
}

// ─── GERADOR DE REELS ────────────────────────────────────────────────────────

async function generateReels(reels, outputDir) {
  log('  Gerando 5 Reels (4 slides cada = 20 imagens)...');
  ensureDir(outputDir);

  for (let i = 0; i < reels.length; i++) {
    const reel = { ...reels[i], number: i + 1 };
    const reelNum = `0${i + 1}`;
    log(`  → Reel ${i + 1}/5: gerando conteúdo dos slides via Claude...`);

    // Gera textos dos 4 slides via Claude
    let slides;
    try {
      slides = await generateSlideContent(reel);
      log(`  → Textos dos slides gerados`);
    } catch (err) {
      log(`  → Claude falhou, usando textos do schedule: ${err.message}`);
      slides = {
        slide1: { headline: reel.headline, body: 'Você sabe a resposta?' },
        slide2: { headline: 'Entenda o motivo', body: reel.body || reel.headline },
        slide3: { headline: 'A Dica Principal:', body: reel.cta || 'Aplique isso no seu treino!' },
        slide4: { headline: 'Quer mais dicas assim?', body: 'Segue @leandro_personall para não perder nenhum treino!' }
      };
    }

    // Gera 4 imagens Kie.ai (uma por slide) e renderiza cada slide
    const slideTemplates = [reelSlide1Hook, reelSlide2Dev, reelSlide3Tip, reelSlide4CTA];
    const slideKeys = ['slide1', 'slide2', 'slide3', 'slide4'];

    for (let s = 0; s < 4; s++) {
      const slideNum = s + 1;
      const bgPath = path.join(TEMP_DIR, `reel-bg-${i + 1}-s${slideNum}-${Date.now()}.png`);

      log(`  → Reel ${i + 1} Slide ${slideNum}/4: gerando imagem (Kie.ai Flux)...`);
      await generateImage(reel.image_prompt, bgPath);

      const slideData = slides[slideKeys[s]];
      const html = slideTemplates[s](slideData, bgPath);
      const pngName = `reel-${reelNum}-slide${slideNum}.png`;
      await renderHTML(html, path.join(outputDir, pngName), 1080, 1920);
      log(`  → ${pngName} renderizado`);

      if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
    }
    log(`  ✅ Reel ${i + 1} concluído (4 slides)`);
  }
  log('  5 Reels concluídos! (20 imagens no total)');
}

// ─── GERADOR DE REEL DICA DO PERSONAL ────────────────────────────────────────

async function generateDicaReel(dica, outputDir) {
  log('  Gerando Reel Dica do Personal...');
  ensureDir(outputDir);

  const bgPath = path.join(TEMP_DIR, `dica-bg-${Date.now()}.png`);
  log(`  → Gerando foto da receita (Kie.ai Flux)...`);
  await generateFoodImage(dica.image_prompt, bgPath);

  const html = recipeDicaReel(dica, bgPath);
  const pngName = `reel-dica.png`;
  await renderHTML(html, path.join(outputDir, pngName), 1080, 1920);

  if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
  log(`  → reel-dica.png renderizado`);
}

// ─── GERADOR DE POST ÚNICO ────────────────────────────────────────────────────

async function generatePost(post, index, outputDir) {
  log(`  Gerando post ${index} (${post.type})...`);
  ensureDir(outputDir);

  const bgPath = path.join(TEMP_DIR, `post-bg-${index}-${Date.now()}.png`);
  log(`  → Gerando imagem (Kie.ai Flux)...`);
  await generateImage(post.image_prompt, bgPath);

  let html, strategy;
  try {
    const result = await generateSmartHTML(post, bgPath, 'post');
    html = result.html;
    strategy = result.strategy;
    log(`  → Layout gerado via Claude (${strategy})`);
  } catch (err) {
    log(`  → Claude renderer falhou, usando template padrão: ${err.message}`);
    html = singlePost(post, bgPath);
  }

  const pngName = `post-${index}-${post.type}.png`;
  await renderHTML(html, path.join(outputDir, pngName));

  // Salva foto bruta para o story usar como fundo (sem texto)
  const rawName = `post-${index}-raw.png`;
  fs.copyFileSync(bgPath, path.join(outputDir, rawName));

  if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
  log(`  → Post ${index} pronto: ${pngName}`);
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('═══════════════════════════════════════════');
  log('BioNexus Digital Daily Generator — Iniciando...');
  log('═══════════════════════════════════════════');

  ensureDir(TEMP_DIR);
  ensureDir(LOGS_DIR);

  const dateStr = today();
  log(`Data: ${dateStr}`);

  // Busca cronograma
  const found = findSchedule(dateStr);
  if (!found) {
    log(`ERRO: Nenhum cronograma encontrado para ${dateStr}.`);
    log('Execute o weekly-planner.cjs para gerar o cronograma desta semana.');
    process.exit(1);
  }
  log(`Cronograma carregado: ${found.file}`);

  const dayPlan = found.plan.days[dateStr];

  // Cria pasta de saída no OneDrive
  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  ensureDir(outDir);
  log(`Pasta de saída: ${outDir}`);

  // Gera 5 Reels
  log('');
  log('🎬 REELS:');
  await generateReels(dayPlan.reels || [], outDir);

  // Gera 3 posts únicos
  for (let i = 0; i < dayPlan.posts.length; i++) {
    log('');
    log(`📱 POST ${i + 1}/${dayPlan.posts.length}:`);
    await generatePost(dayPlan.posts[i], i + 1, outDir);
  }

  // Gera Reel Dica do Personal
  // Receita: usa sempre o banco dedicado (não o planner), garante variedade e sem repetição
  const receitaDoDia = getNextRecipe();
  const status = getBankStatus();
  log(`  → Receita do dia: "${receitaDoDia.title}" (${status.remaining} restantes no ciclo ${status.current_cycle})`);
  dayPlan.dica_receita = receitaDoDia;

  if (dayPlan.dica_receita) {
    log('');
    log('🍽️ DICA DO PERSONAL:');
    await generateDicaReel(dayPlan.dica_receita, outDir);
  }

  // Gera PUBLICAR.md (com retry caso arquivo esteja travado pelo OneDrive)
  const publicarMd = buildPublicarMd(dateStr, dayPlan);
  const publicarPath = path.join(outDir, 'PUBLICAR.md');
  let saved = false;
  for (let attempt = 1; attempt <= 10; attempt++) {
    try {
      fs.writeFileSync(publicarPath, publicarMd, 'utf8');
      saved = true;
      break;
    } catch (e) {
      if (e.code === 'EBUSY' && attempt < 10) {
        log(`  PUBLICAR.md travado (OneDrive sync), tentativa ${attempt}/10 — aguardando 5s...`);
        await new Promise(r => setTimeout(r, 5000));
      } else throw e;
    }
  }
  log('');
  log('📄 PUBLICAR.md gerado');

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ CONCLUÍDO! ${4} arquivos prontos em:`);
  log(`   ${outDir}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
