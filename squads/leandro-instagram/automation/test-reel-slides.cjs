/**
 * test-reel-slides.cjs — Testa geração de 4 slides para Reel 1
 */
const fs   = require('fs');
const path = require('path');

// Carrega .env
const envPath = path.join(__dirname, '../.env');
for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && k.trim() && !k.trim().startsWith('#')) process.env[k.trim()] = v.join('=').trim();
}

const { generateImage }    = require('./lib/kie.cjs');
const { renderHTML, reelSlide1Hook, reelSlide2Dev, reelSlide3Tip, reelSlide4CTA } = require('./lib/renderer.cjs');
const { slidesToMp4 }     = require('./lib/ffmpeg.cjs');
const { gerarTexto } = require('./lib/ai-helper.cjs');

const OUT_DIR  = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/test-reel-slides';
const TEMP_DIR = 'C:/bionexus_render_tmp';
if (!fs.existsSync(OUT_DIR))  fs.mkdirSync(OUT_DIR, { recursive: true });
if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

const REEL = {
  type: 'educativo',
  headline: 'O erro que TRAVA seu metabolismo!',
  image_prompt: 'Full body shot from head to toe of a beautiful Brazilian fitness woman, with long straight black hair, light brown skin, navy blue high-waist leggings and matching sports bra, front view full body standing confidently with hands on hips, smiling directly at camera, full length from head to toe, in a modern gym with natural light, warm cinematic lighting, hyperrealistic, photorealistic, 8K',
  cta: "💬 Comenta 'QUERO' se quer saber como acelerar o seu!"
};

async function generateSlideContent(reel) {
  const prompt = `Você é especialista em conteúdo fitness para Instagram de @leandro_personall, personal trainer feminino.

Tema do reel: "${reel.headline}"
Tipo: ${reel.type}

Gere os textos dos 4 slides deste reel em português, diretos e impactantes.
Responda APENAS com JSON válido, sem texto extra:

{
  "slide1": { "headline": "Pergunta ou gancho impactante (máx 8 palavras, use ? ou !)", "body": "Frase curta que desperta curiosidade (máx 12 palavras)" },
  "slide2": { "headline": "Título do desenvolvimento (máx 6 palavras)", "body": "Explicação clara e prática do tema (máx 30 palavras)" },
  "slide3": { "headline": "A Dica Principal:", "body": "Dica prática e acionável sobre o tema (máx 25 palavras, use verbos de ação)" },
  "slide4": { "headline": "Quer mais dicas assim?", "body": "Segue @leandro_personall e ativa as notificações para não perder nenhum treino!" }
}`;

  const text = await gerarTexto(prompt, 600);
  return JSON.parse(text.match(/\{[\s\S]*\}/)[0]);
}

async function main() {
  console.log('=== TESTE: 4 Slides do Reel 1 ===\n');

  // 1. Gera textos via IA (Groq→Cerebras)
  console.log('1/3 — Gerando textos dos slides via IA...');
  const slides = await generateSlideContent(REEL);
  console.log('Textos gerados:');
  Object.entries(slides).forEach(([k, v]) => console.log(`  ${k}: "${v.headline}" / "${v.body}"`));
  console.log();

  // 2. Gera 4 imagens + renderiza slides
  const slideTemplates = [reelSlide1Hook, reelSlide2Dev, reelSlide3Tip, reelSlide4CTA];
  const slideKeys      = ['slide1', 'slide2', 'slide3', 'slide4'];
  const slidePaths     = [];

  console.log('2/3 — Gerando imagens e renderizando slides...');
  for (let s = 0; s < 4; s++) {
    const bgPath  = path.join(TEMP_DIR, `test-reel-bg-s${s+1}-${Date.now()}.png`);
    const pngPath = path.join(OUT_DIR,  `reel-01-slide${s+1}.png`);

    console.log(`  → Slide ${s+1}/4: gerando imagem Kie.ai...`);
    await generateImage(REEL.image_prompt, bgPath);

    const html = slideTemplates[s](slides[slideKeys[s]], bgPath);
    await renderHTML(html, pngPath, 1080, 1920);
    console.log(`  ✅ reel-01-slide${s+1}.png`);

    slidePaths.push(pngPath);
    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
  }
  console.log();

  // 3. Converte 4 slides → MP4
  console.log('3/3 — Convertendo 4 slides em MP4...');
  const mp4Path = path.join(OUT_DIR, 'reel-01-test.mp4');
  slidesToMp4(slidePaths, mp4Path, 5);
  console.log(`  ✅ reel-01-test.mp4 (20 segundos)`);

  console.log('\n✅ TESTE CONCLUÍDO!');
  console.log('Pasta:', OUT_DIR);
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
