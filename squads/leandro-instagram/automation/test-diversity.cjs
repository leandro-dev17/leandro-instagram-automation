/**
 * test-diversity.cjs
 * Gera 4 imagens para validar: corpo inteiro, diversidade e sem mãos defeituosas.
 */

const path = require('path');
const fs = require('fs');
const { generateImage } = require('./lib/kie.cjs');

const OUT_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/test-diversity';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPTS = [
  {
    name: 'standing-confident',
    prompt: 'Full body shot from head to toe of a beautiful Brazilian fitness woman, toned athletic curvy build with round glutes, standing confidently with hands on hips, smiling at camera, wearing coral pink high-waist leggings and black sports bra, modern gym background with mirrors, warm cinematic lighting'
  },
  {
    name: 'hip-thrust',
    prompt: 'Full body shot from head to toe of a beautiful Brazilian fitness woman, toned athletic curvy build with round glutes, performing hip thrust on padded bench showing full body side view glutes contracted, wearing navy blue high-waist leggings and matching sports bra, gym background with weights, cinematic warm lighting'
  },
  {
    name: 'back-view',
    prompt: 'Full body shot from head to toe of a beautiful Brazilian fitness woman, toned athletic curvy build with round glutes, back view showing full body with defined glutes and legs looking over shoulder with confident smile, wearing black leggings and white crop top, gym environment, warm lighting'
  },
  {
    name: 'cable-kickback',
    prompt: 'Full body shot from head to toe of a beautiful Brazilian fitness woman, toned athletic curvy build with round glutes, performing cable kickback showing full body profile with glute extension, wearing colorful tie-dye leggings and beige sports bra, gym with cable machine background, cinematic lighting'
  }
];

async function main() {
  console.log('Testando diversidade e corpo inteiro — 4 imagens...\n');
  for (const p of PROMPTS) {
    const outPath = path.join(OUT_DIR, `${p.name}.png`);
    console.log(`→ Gerando: ${p.name}...`);
    await generateImage(p.prompt, outPath);
    console.log(`  ✅ ${p.name}.png\n`);
  }
  console.log('✅ Teste concluído! Pasta:', OUT_DIR);
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
