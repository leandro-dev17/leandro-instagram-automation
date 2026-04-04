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
    prompt: 'Full body shot from head to toe of a beautiful lean athletic fitness woman in her 30s, slim waist, flat toned stomach, defined toned legs and arms, natural realistic body proportions, with long straight dark brown hair, light tan skin, natural makeup, standing confidently with hands on hips smiling directly at camera, wearing yellow high-waist biker shorts and white sports bra white sneakers, modern gym with large mirrors background, warm cinematic lighting, hyperrealistic, photorealistic, 8K, no text, no watermark'
  },
  {
    name: 'hip-thrust',
    prompt: 'Full body shot from head to toe of a beautiful lean athletic fitness woman in her 30s, slim waist, flat toned stomach, defined toned legs and arms, natural realistic body proportions, with shoulder-length straight black hair, medium brown skin, natural smile, performing hip thrust exercise on padded bench side view, wearing navy blue high-waist leggings and matching navy sports bra, gym with weights rack background, warm cinematic lighting, hyperrealistic, photorealistic, 8K, no text, no watermark'
  },
  {
    name: 'back-view',
    prompt: 'Full body shot from head to toe of a beautiful lean athletic fitness woman in her 30s, slim waist, flat toned stomach, defined toned legs and arms, natural realistic body proportions, with curly brunette hair tied up, warm medium skin tone, back view looking over shoulder with confident smile, wearing black high-waist leggings and white crop top, real gym environment, warm cinematic lighting, hyperrealistic, photorealistic, 8K, no text, no watermark'
  },
  {
    name: 'cable-kickback',
    prompt: 'Three-quarter body shot from knees to top of head of a beautiful lean athletic fitness woman in her 30s, slim waist, flat toned stomach, defined toned legs and arms, natural realistic body proportions, with long straight dark hair loose, light tan skin, performing cable kickback exercise profile view, wearing pink high-waist leggings and pink sports bra, gym with cable machine background, warm cinematic lighting, hyperrealistic, photorealistic, 8K, no text, no watermark'
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
