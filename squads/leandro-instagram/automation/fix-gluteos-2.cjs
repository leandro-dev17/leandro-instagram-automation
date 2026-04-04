/**
 * fix-gluteos-2.cjs
 * Regenera apenas as 2 imagens que faltaram por falta de créditos:
 * - post-3-cientifico
 * - reel-dica
 */

const fs = require('fs');
const path = require('path');

const { generateImage } = require('./lib/kie.cjs');
const { recipeDicaReel, singlePost, renderHTML } = require('./lib/renderer.cjs');

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

const FIXES = [
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

async function main() {
  log('═══════════════════════════════════════════');
  log('BioNexus — Finalizando 2 imagens restantes');
  log('═══════════════════════════════════════════');

  ensureDir(TEMP_DIR);

  for (const fix of FIXES) {
    log('');
    log(`🔧 ${fix.label}`);
    const bgPath = path.join(TEMP_DIR, `fix2-bg-${Date.now()}.png`);

    log('   Gerando imagem (Kie.ai Flux)...');
    await generateImage(fix.image_prompt, bgPath);

    const outPath = path.join(OUT_DIR, fix.filename);

    if (fix.type === 'post') {
      const html = singlePost(fix.data, bgPath);
      await renderHTML(html, outPath);
    } else if (fix.type === 'dica') {
      const html = recipeDicaReel(fix.data, bgPath);
      await renderHTML(html, outPath, 1080, 1920);
    }

    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
    log(`   ✅ ${fix.filename} pronto`);
  }

  log('');
  log('═══════════════════════════════════════════');
  log('✅ TUDO CONCLUÍDO! Pasta pronta para publicar:');
  log(`   ${OUT_DIR}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
