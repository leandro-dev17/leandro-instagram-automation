/**
 * fix-gluteos.cjs
 * Regenera apenas as imagens problemáticas com prompts corrigidos:
 * - post-2-educativo: corpo inteiro visível
 * - post-3-cientifico: mulher explícita, corpo inteiro
 * - reel-dica: fotografia de comida (sem pessoa)
 * - todos os reels: corpos mais visíveis
 */

const fs = require('fs');
const path = require('path');

const { generateImage } = require('./lib/kie.cjs');
const { reelPost, recipeDicaReel, singlePost, renderHTML } = require('./lib/renderer.cjs');

const LOGS_DIR = path.join(__dirname, 'logs');
const TEMP_DIR = path.join(__dirname, 'temp');
const OUT_DIR  = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/2026-04-01-gluteos';

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOGS_DIR, 'generator.log'), line + '\n');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ─── PROMPTS CORRIGIDOS ───────────────────────────────────────────────────────
// Regra geral Flux: corpo inteiro, ângulo de corpo completo, sem restrições de mãos
// "female" e "woman" sempre explícitos e no início do prompt

const FIXES = [
  {
    label: 'Post 3 — Científico (mulher, corpo inteiro)',
    filename: 'reel-01.png',
    type: 'reel',
    data: {
      number: 1,
      type: 'motivacional',
      headline: 'Glúteos dos sonhos: é possível SIM!',
      accent: 'SIM',
      body: 'Com treino certo e consistência, qualquer mulher pode transformar seu bumbum. Eu vou te provar!',
      cta: '💬 Salva e marca aquela amiga que precisa ver isso!'
    },
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, toned athletic body with curvy round glutes, standing confidently in modern gym, wearing navy blue high-waist leggings and matching sports bra, back facing camera showing well-defined glutes and legs, looking over shoulder with confident smile, full length from head to toe, barbell rack in background, warm amber gym lighting, hyperrealistic photography, photorealistic, 8K'
  },
  {
    label: 'Reel 2 — Hip Thrust (corpo inteiro)',
    filename: 'reel-02.png',
    type: 'reel',
    data: {
      number: 2,
      type: 'educativo',
      headline: 'Os 3 MELHORES exercícios para glúteos',
      accent: 'MELHORES',
      body: 'Hip thrust, agachamento búlgaro e abdução. Domine esses 3 e veja seu bumbum crescer!',
      cta: '💾 Salva essa dica de ouro!'
    },
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, curvy athletic body with strong glutes, performing hip thrust exercise on a padded bench with heavy barbell across hips, wearing coral pink high-waist leggings and black sports bra, side view showing entire body from head to toe with glutes at top of movement contracted, gym with mirror and weights in background, determined happy expression, cinematic warm lighting, hyperrealistic photography, photorealistic, 8K'
  },
  {
    label: 'Reel 3 — Deadlift (corpo inteiro)',
    filename: 'reel-03.png',
    type: 'reel',
    data: {
      number: 3,
      type: 'cientifico',
      headline: 'Por que glúteos crescem com CARGA progressiva?',
      accent: 'CARGA',
      body: 'Sem sobrecarga, não há hipertrofia. A ciência explica como o músculo responde ao estímulo.',
      cta: '🔬 Compartilha com quem treina sem resultado!'
    },
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, strong athletic body with defined curvy glutes, performing Romanian deadlift with heavy barbell, wearing black high-waist leggings and white sports bra, side view showing entire body from head to toe, slight forward lean engaging glutes and hamstrings, gym with squat rack visible in background, intense focused expression, dramatic side cinematic lighting, hyperrealistic photography, photorealistic, 8K'
  },
  {
    label: 'Reel 4 — Ativação glúteos (corpo inteiro)',
    filename: 'reel-04.png',
    type: 'reel',
    data: {
      number: 4,
      type: 'dica',
      headline: 'ATIVE seus glúteos ANTES do treino!',
      accent: 'ATIVE',
      body: 'Sem ativação, você treina e quem trabalha é a coxa. Faça isso antes de cada sessão!',
      cta: '📌 Salva para aplicar no próximo treino!'
    },
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, curvy athletic body, lying on gym mat performing glute bridge with resistance band around thighs, wearing coral pink high-waist leggings and black sports bra, side view showing entire body from head to feet with hips raised and glutes contracted, bright clean gym floor, smiling happily, natural daylight gym lighting, hyperrealistic photography, photorealistic, 8K'
  },
  {
    label: 'Reel 5 — Agachamento búlgaro (corpo inteiro)',
    filename: 'reel-05.png',
    type: 'reel',
    data: {
      number: 5,
      type: 'mitos',
      headline: 'Mito: agachamento NÃO cresce bumbum!',
      accent: 'NÃO',
      body: 'O agachamento é base, mas sem variações específicas seus glúteos ficam limitados. Entenda!',
      cta: '💬 Você cometia esse erro? Comenta aqui!'
    },
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, toned curvy body with strong glutes, performing Bulgarian split squat with dumbbells in both hands, wearing navy blue high-waist leggings and beige sports bra, front three-quarter angle showing full body from head to toe, rear foot elevated on bench, deep lunge position engaging glutes, gym background blurred, confident determined expression, warm cinematic lighting, hyperrealistic photography, photorealistic, 8K'
  },
  {
    label: 'Post 2 — Educativo (corpo inteiro)',
    filename: 'post-2-educativo.png',
    type: 'post',
    data: {
      type: 'educativo',
      headline: 'Periodização para glúteos: como ESTRUTURAR seu treino',
      accent: 'ESTRUTURAR',
      body: 'Sem estrutura, você treina no aleatório e os resultados ficam no aleatório também.'
    },
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, toned athletic body with round curvy glutes, standing in gym with hands on waist, smiling confidently at camera, wearing coordinated coral and black workout outfit with high-waist leggings and sports bra, full length from head to toe showing entire fit body, gym mirrors and equipment in background, warm soft lighting, hyperrealistic photography, photorealistic, 8K'
  },
  {
    label: 'Post 3 — Científico (mulher, corpo inteiro)',
    filename: 'post-3-cientifico.png',
    type: 'post',
    data: {
      type: 'cientifico',
      headline: 'A CIÊNCIA da hipertrofia do glúteo',
      accent: 'CIÊNCIA',
      body: 'Tensão mecânica + dano muscular + estresse metabólico. Entenda os 3 pilares!'
    },
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, very fit and toned feminine body with prominent round glutes, performing squat with barbell on shoulders in gym, wearing dark navy high-waist leggings and navy sports bra, side view showing entire female body from head to toe, strong glute engagement visible at bottom of squat, gym with squat rack and weights in background, dramatic cinematic lighting, long dark hair, feminine features, hyperrealistic photography, photorealistic, 8K, female athlete'
  },
  {
    label: 'Reel Dica — Bowl Proteico (fotografia de comida)',
    filename: 'reel-dica.png',
    type: 'dica',
    data: {
      title: 'Bowl Proteico Pré-Treino de Glúteos',
      headline: 'Bowl Proteico\npara Bombar Glúteos!',
      category: 'pré-treino',
      ingredients_display: [
        '✅ 150g de frango grelhado desfiado',
        '✅ 1/2 xícara de arroz integral cozido',
        '✅ 1/2 batata-doce cozida em cubos',
        '✅ Folhas verdes (rúcula/espinafre)',
        '✅ 1 colher de azeite de oliva',
        '✅ Sal, pimenta e ervas a gosto',
        '✅ 1 colher de sementes de abóbora'
      ]
    },
    image_prompt: 'Professional food photography, a beautiful rustic ceramic bowl filled with fitness meal: shredded grilled chicken breast, cooked brown rice, roasted sweet potato cubes, fresh arugula leaves, drizzled with olive oil, garnished with pumpkin seeds and fresh herbs, wooden table surface, soft natural window light from left side, shallow depth of field with blurred background, appetizing and mouth-watering, Michelin-quality food styling, no people, no text, no watermark, hyperrealistic, 8K UHD'
  }
];

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function main() {
  log('═══════════════════════════════════════════');
  log('BioNexus — Corrigindo imagens problemáticas');
  log('═══════════════════════════════════════════');

  ensureDir(TEMP_DIR);

  for (const fix of FIXES) {
    log('');
    log(`🔧 ${fix.label}`);
    const bgPath = path.join(TEMP_DIR, `fix-bg-${Date.now()}.png`);

    log('   Gerando imagem (Kie.ai Flux)...');
    await generateImage(fix.image_prompt, bgPath);

    const outPath = path.join(OUT_DIR, fix.filename);

    if (fix.type === 'reel') {
      const html = reelPost(fix.data, bgPath);
      await renderHTML(html, outPath, 1080, 1920);
    } else if (fix.type === 'post') {
      const html = singlePost(fix.data, bgPath);
      await renderHTML(html, outPath);
    } else if (fix.type === 'dica') {
      const html = recipeDicaReel(fix.data, bgPath);
      await renderHTML(html, outPath, 1080, 1920);
    }

    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
    log(`   ✅ ${fix.filename} substituído`);
  }

  log('');
  log('═══════════════════════════════════════════');
  log('✅ CORREÇÕES CONCLUÍDAS!');
  log(`   Pasta: ${OUT_DIR}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
