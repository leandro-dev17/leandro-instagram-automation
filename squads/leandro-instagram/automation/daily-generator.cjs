/**
 * daily-generator.cjs
 * Roda automaticamente às 5h via Windows Task Scheduler.
 *
 * Produz por dia:
 *   1 Story   — 5 slides (1 imagem Kie.ai reutilizada) → story-slide1..5.png
 *   1 Carrossel — 7 slides (1 imagem Kie.ai reutilizada) → carousel-slide1..7.png
 *   1 Reel Dica — imagem de alimento (Kie.ai) → reel-dica.png
 *   PUBLICAR.md — guia de publicação com captions e hashtags
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
const { storySlide, carouselSlide, renderHTML } = require('./lib/renderer.cjs');
const { getNextRecipe, getBankStatus } = require('./lib/recipe-manager.cjs');
const { recipeDicaReel } = require('./lib/renderer.cjs');

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
  if (process.argv[2] && /^\d{4}-\d{2}-\d{2}$/.test(process.argv[2])) {
    return process.argv[2];
  }
  return new Date().toISOString().slice(0, 10);
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

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

function safePrompt(defaultPrompt) {
  return defaultPrompt || 'Brazilian female personal trainer in her 30s, lean athletic body, standing confidently in bright modern gym, wearing pink high-waist leggings and matching sports bra, smiling at camera, natural lighting';
}

async function kieImage(prompt, destPath) {
  try {
    await generateImage(prompt || '', destPath);
  } catch (err) {
    if (err.message.includes('sensitive') || err.message.includes('E005')) {
      log(`  → E005 bloqueado — tentando prompt seguro...`);
      await generateImage('', destPath); // kie.cjs ignora o prompt mesmo, usa pools
    } else {
      throw err;
    }
  }
}

// ─── CLAUDE: conteúdo dos 5 slides do story ───────────────────────────────────

async function generateStoryContent(story) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você é especialista em conteúdo viral para Instagram Stories de @leandro_personall, personal trainer feminina focada em emagrecimento e treino por ciclo menstrual.

Tema do story: "${story.topic}"
Tipo: ${story.type || 'dica'}

Crie os textos dos 5 slides do story. A estrutura OBRIGATÓRIA é:
- Slide 1 (GANCHO): afirmação polêmica ou dor direta — NÃO use pergunta genérica, use uma afirmação que choca
- Slide 2 (REVELAÇÃO): aprofunda o problema, por que acontece
- Slide 3 (PROVA): dado, número ou exemplo real que valida
- Slide 4 (SOLUÇÃO): resposta prática em 2-3 pontos acionáveis
- Slide 5 (CTA): call-to-action urgente que força ação imediata

Responda APENAS com JSON válido:

{
  "slide1": {
    "label": "GANCHO",
    "style": "hook",
    "headline": "Afirmação de impacto (máx 8 palavras, sem ?)",
    "body": "Frase de apoio curta (máx 10 palavras)"
  },
  "slide2": {
    "label": "O PROBLEMA",
    "style": "content",
    "headline": "Título da revelação (máx 6 palavras)",
    "body": "Explicação do problema real (máx 35 palavras)"
  },
  "slide3": {
    "label": "A VERDADE",
    "style": "content",
    "headline": "Dado ou fato chocante (máx 6 palavras)",
    "body": "Contexto do dado (máx 30 palavras)"
  },
  "slide4": {
    "label": "A SOLUÇÃO",
    "style": "content",
    "headline": "Como resolver (máx 5 palavras)",
    "points": ["ponto prático 1 (máx 9 palavras)", "ponto prático 2 (máx 9 palavras)", "ponto prático 3 (máx 9 palavras)"]
  },
  "slide5": {
    "label": "AGORA",
    "style": "cta",
    "headline": "Frase de impacto final (máx 6 palavras)",
    "cta": "CTA urgente e específico (ex: 'Salva antes de fechar 💾', 'Marca a amiga que precisa ver isso 👇', 'Me chama no direct agora 📩')"
  }
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 800,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido para story');
  return JSON.parse(match[0]);
}

// ─── CLAUDE: conteúdo dos 7 slides do carrossel ───────────────────────────────

async function generateCarouselContent(carousel) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você é especialista em conteúdo viral para carrossel do Instagram de @leandro_personall, personal trainer feminina.

Tema do carrossel: "${carousel.topic}"
Tipo: ${carousel.type || 'educativo'}
Caption base (use como referência de tom): ${carousel.caption || ''}

Crie os textos dos 7 slides do carrossel. Estrutura OBRIGATÓRIA:
- Slide 1 (CAPA): hook que faz a pessoa arrastar — promessa de valor clara
- Slide 2 (DOR): a dor real que sua seguidora sente — empatia
- Slide 3 (REVELAÇÃO): por que o método convencional não funciona
- Slide 4 (SOLUÇÃO 1): primeiro ponto prático com ação concreta
- Slide 5 (SOLUÇÃO 2): segundo ponto prático com ação concreta
- Slide 6 (PROVA): resultado real ou dado que valida a solução
- Slide 7 (CTA): salvar + seguir + marcar amiga

Responda APENAS com JSON válido:

{
  "slide1": {
    "label": "LEIA ISSO",
    "style": "cover",
    "headline": "Hook impactante que faz arrastar (máx 8 palavras)",
    "body": "Promessa de valor do carrossel (máx 12 palavras)"
  },
  "slide2": {
    "label": "A DOR",
    "style": "content",
    "headline": "A dor real em palavras dela (máx 6 palavras)",
    "body": "Descrição empática do problema (máx 35 palavras)"
  },
  "slide3": {
    "label": "O ERRO",
    "style": "content",
    "headline": "Por que não funciona (máx 6 palavras)",
    "body": "Explicação do erro comum (máx 35 palavras)"
  },
  "slide4": {
    "label": "PASSO 1",
    "style": "content",
    "headline": "Nome do passo (máx 5 palavras)",
    "points": ["ação prática 1 (máx 10 palavras)", "ação prática 2 (máx 10 palavras)", "ação prática 3 (máx 10 palavras)"]
  },
  "slide5": {
    "label": "PASSO 2",
    "style": "content",
    "headline": "Nome do segundo passo (máx 5 palavras)",
    "points": ["ação prática 1 (máx 10 palavras)", "ação prática 2 (máx 10 palavras)", "ação prática 3 (máx 10 palavras)"]
  },
  "slide6": {
    "label": "RESULTADO",
    "style": "content",
    "headline": "Resultado esperado (máx 6 palavras)",
    "body": "Prova, dado ou exemplo real (máx 35 palavras)"
  },
  "slide7": {
    "label": "AGORA",
    "style": "cta",
    "headline": "Frase final de impacto (máx 6 palavras)",
    "cta": "CTA composto: salvar + marcar amiga (ex: '💾 Salva + marca a amiga que precisa')"
  }
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{ role: 'user', content: prompt }]
  });

  const text = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido para carrossel');
  return JSON.parse(match[0]);
}

// ─── GERADOR DE STORY (5 slides, 1 imagem base) ───────────────────────────────

async function generateStory(story, outputDir) {
  // Verifica se já existe
  const allExist = [1,2,3,4,5].every(n => fs.existsSync(path.join(outputDir, `story-slide${n}.png`)));
  if (allExist) {
    log('  → Story: todos os slides já existem, pulando');
    return;
  }

  log('  📱 STORY: gerando 5 slides (1 imagem base)...');
  ensureDir(outputDir);

  // 1. Gera 1 imagem base no Kie.ai
  const basePath = path.join(TEMP_DIR, `story-base-${Date.now()}.png`);
  log('  → Gerando imagem base (Kie.ai)...');
  await kieImage(story.image_prompt || '', basePath);
  log('  → Imagem base gerada');

  // 2. Gera conteúdo dos 5 slides via Claude
  log('  → Gerando textos dos slides via Claude...');
  let slides;
  try {
    slides = await generateStoryContent(story);
    log('  → Textos gerados com sucesso');
  } catch (err) {
    log(`  → Claude falhou, usando textos de fallback: ${err.message}`);
    slides = {
      slide1: { label: 'GANCHO', style: 'hook', headline: story.topic || 'Você precisa saber disso', body: 'Isso vai mudar seu treino para sempre' },
      slide2: { label: 'O PROBLEMA', style: 'content', headline: 'O erro mais comum', body: 'A maioria das mulheres treina sem entender como o próprio corpo funciona, perdendo resultados.' },
      slide3: { label: 'A VERDADE', style: 'content', headline: 'O que a ciência diz', body: 'Estudos mostram que alinhar treino ao ciclo aumenta resultados em até 40%.' },
      slide4: { label: 'A SOLUÇÃO', style: 'content', headline: 'Como aplicar hoje', points: ['Identifique sua fase do ciclo', 'Ajuste a intensidade do treino', 'Alimente-se estrategicamente'] },
      slide5: { label: 'AGORA', style: 'cta', headline: 'Não perde essa dica', cta: 'Salva antes de fechar 💾' }
    };
  }

  // 3. Renderiza cada slide reutilizando a imagem base
  const slideKeys = ['slide1', 'slide2', 'slide3', 'slide4', 'slide5'];
  for (let i = 0; i < slideKeys.length; i++) {
    const slideNum = i + 1;
    const slideData = slides[slideKeys[i]];
    const html = storySlide({ ...slideData, slideNum, totalSlides: 5 }, basePath);
    const outName = `story-slide${slideNum}.png`;
    await renderHTML(html, path.join(outputDir, outName), 1080, 1920);
    log(`  → story-slide${slideNum}.png renderizado [${slideData.label}]`);
  }

  // 4. Limpa imagem temporária
  if (fs.existsSync(basePath)) fs.unlinkSync(basePath);
  log('  ✅ Story concluído (5 slides, 1 imagem Kie.ai)');
}

// ─── GERADOR DE CARROSSEL (7 slides, 1 imagem base) ──────────────────────────

async function generateCarousel(carousel, outputDir) {
  // Verifica se já existe
  const allExist = [1,2,3,4,5,6,7].every(n => fs.existsSync(path.join(outputDir, `carousel-slide${n}.png`)));
  if (allExist) {
    log('  → Carrossel: todos os slides já existem, pulando');
    return;
  }

  log('  🖼️  CARROSSEL: gerando 7 slides (1 imagem base)...');
  ensureDir(outputDir);

  // 1. Gera 1 imagem base no Kie.ai
  const basePath = path.join(TEMP_DIR, `carousel-base-${Date.now()}.png`);
  log('  → Gerando imagem base (Kie.ai)...');
  await kieImage(carousel.image_prompt || '', basePath);
  log('  → Imagem base gerada');

  // 2. Gera conteúdo dos 7 slides via Claude
  log('  → Gerando textos dos slides via Claude...');
  let slides;
  try {
    slides = await generateCarouselContent(carousel);
    log('  → Textos gerados com sucesso');
  } catch (err) {
    log(`  → Claude falhou, usando textos de fallback: ${err.message}`);
    slides = {
      slide1: { label: 'LEIA ISSO', style: 'cover', headline: carousel.topic || 'O que ninguém te conta sobre treino', body: 'Arraste e descubra como transformar seu resultado' },
      slide2: { label: 'A DOR', style: 'content', headline: 'Você se identifica?', body: 'Treina duro mas o resultado não aparece. Segue dieta mas o peso não sai.' },
      slide3: { label: 'O ERRO', style: 'content', headline: 'O método convencional falha', body: 'Treinar todo dia igual ignora a biologia feminina — seu corpo muda a cada semana.' },
      slide4: { label: 'PASSO 1', style: 'content', headline: 'Conheça seu ciclo', points: ['Anote os dias da menstruação', 'Identifique cada fase', 'Veja padrões de energia e disposição'] },
      slide5: { label: 'PASSO 2', style: 'content', headline: 'Alinhe o treino', points: ['Fase folicular: intensidade máxima', 'Fase lútea: volume moderado', 'Menstruação: recuperação ativa'] },
      slide6: { label: 'RESULTADO', style: 'content', headline: 'O que você vai ver', body: 'Mais disposição, menos platô, resultados visíveis em 30 dias. Não é milagre — é estratégia.' },
      slide7: { label: 'AGORA', style: 'cta', headline: 'Salva e aplica hoje', cta: '💾 Salva + marca a amiga que precisa' }
    };
  }

  // 3. Renderiza cada slide reutilizando a imagem base
  const slideKeys = ['slide1','slide2','slide3','slide4','slide5','slide6','slide7'];
  for (let i = 0; i < slideKeys.length; i++) {
    const slideNum = i + 1;
    const slideData = slides[slideKeys[i]];
    const html = carouselSlide({ ...slideData, slideNum, totalSlides: 7 }, basePath);
    const outName = `carousel-slide${slideNum}.png`;
    await renderHTML(html, path.join(outputDir, outName), 1080, 1350);
    log(`  → carousel-slide${slideNum}.png renderizado [${slideData.label}]`);
  }

  // 4. Limpa imagem temporária
  if (fs.existsSync(basePath)) fs.unlinkSync(basePath);
  log('  ✅ Carrossel concluído (7 slides, 1 imagem Kie.ai)');
}

// ─── GERADOR DE REEL DICA DO PERSONAL (mantido igual) ────────────────────────

async function generateDicaReel(dica, outputDir) {
  const dicaPath = path.join(outputDir, 'reel-dica.png');
  if (fs.existsSync(dicaPath)) {
    log('  → reel-dica.png já existe, pulando');
    return;
  }
  log('  🍽️  DICA DO PERSONAL: gerando imagem de alimento...');
  ensureDir(outputDir);

  const bgPath = path.join(TEMP_DIR, `dica-bg-${Date.now()}.png`);
  await generateFoodImage(dica.image_prompt, bgPath);

  const html = recipeDicaReel(dica, bgPath);
  await renderHTML(html, dicaPath, 1080, 1920);

  if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
  log('  → reel-dica.png renderizado');
  log('  ✅ Dica do Personal concluída');
}

// ─── PUBLICAR.md ──────────────────────────────────────────────────────────────

function buildPublicarMd(dateStr, dayPlan) {
  const story = dayPlan.story || {};
  const carousel = dayPlan.carousel || {};
  const dica = dayPlan.dica_receita || {};

  const lines = [
    `# Conteúdo do dia — ${dateStr}`,
    `**Gerado automaticamente às 5h por BioNexus Digital**`,
    ``,
    `---`,
    ``,
    `## 📱 STORY (5 slides — publicar como story sequencial)`,
    `**Arquivos:** story-slide1.png → story-slide5.png`,
    ``,
    `**Tema:** ${story.topic || ''}`,
    `**Hashtags:** ${story.hashtags || ''}`,
    ``,
    `**Caption para o story (opcional no último slide):**`,
    story.caption || '',
    ``,
    `---`,
    ``,
    `## 🖼️  CARROSSEL (7 slides — publicar como post carrossel)`,
    `**Arquivos:** carousel-slide1.png → carousel-slide7.png`,
    ``,
    `**Tema:** ${carousel.topic || ''}`,
    ``,
    `**Caption completa:**`,
    carousel.caption || '',
    ``,
    `**Hashtags:**`,
    carousel.hashtags || '',
    ``,
    `---`,
    ``,
    `## 🍽️  DICA DO PERSONAL`,
    `**Arquivo:** reel-dica.png`,
    `**Categoria:** ${dica.category || ''}`,
    ``,
    `**Caption + Receita:**`,
    dica.caption || '',
    ``,
    `**Hashtags:**`,
    dica.hashtags || '',
    ``,
    `---`,
    ``,
    `## ✅ Checklist de publicação`,
    `- [ ] Story: publicar slides 1-5 em sequência`,
    `- [ ] Carrossel: publicar 7 slides como post no feed`,
    `- [ ] Reel Dica do Personal: publicar como reel`,
    `- [ ] Responder comentários nas primeiras 2h`,
    ``,
    `*Gerado por BioNexus Digital — @leandro_personall*`
  ];

  return lines.join('\n');
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

  // Pasta de saída no OneDrive
  const outDir = path.join(ONEDRIVE_DIR, dateStr);
  ensureDir(outDir);
  log(`Pasta de saída: ${outDir}`);

  // ── Story (5 slides) ────────────────────────────────────────────────────────
  log('');
  if (dayPlan.story) {
    await generateStory(dayPlan.story, outDir);
  } else {
    log('  Story não encontrado no cronograma — pulando');
  }

  // ── Carrossel (7 slides) ────────────────────────────────────────────────────
  log('');
  if (dayPlan.carousel) {
    await generateCarousel(dayPlan.carousel, outDir);
  } else {
    log('  Carrossel não encontrado no cronograma — pulando');
  }

  // ── Dica do Personal ────────────────────────────────────────────────────────
  const receitaDoDia = getNextRecipe();
  const status = getBankStatus();
  log(`\n  → Receita do dia: "${receitaDoDia.title}" (${status.remaining} restantes no ciclo ${status.current_cycle})`);
  dayPlan.dica_receita = receitaDoDia;

  log('');
  await generateDicaReel(dayPlan.dica_receita, outDir);

  // ── PUBLICAR.md ─────────────────────────────────────────────────────────────
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
  log(`✅ CONCLUÍDO! Arquivos prontos em:`);
  log(`   ${outDir}`);
  log('   story-slide1..5.png | carousel-slide1..7.png | reel-dica.png');
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
