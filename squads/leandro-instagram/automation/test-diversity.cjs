/**
 * test-diversity.cjs
 * Gera 4 imagens para validar: corpo inteiro, diversidade e sem mãos defeituosas.
 */

const path = require('path');
const fs = require('fs');
const { generateImage } = require('./lib/kie.cjs');

const OUT_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/teste-v2';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPTS = [
  {
    name: 'standing-confident',
    prompt: 'standing confidently with hands on hips, smiling directly at camera, modern gym with large mirrors background'
  },
  {
    name: 'hip-thrust',
    prompt: 'performing hip thrust exercise on padded bench, gym with weights rack background'
  },
  {
    name: 'side-profile',
    prompt: 'profile side view, standing in front of large gym window with one hand on hip, bright smile, real gym environment'
  },
  {
    name: 'cable-kickback',
    prompt: 'performing cable glute kickback exercise, standing at cable machine facing sideways, gym with cable machine background'
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
