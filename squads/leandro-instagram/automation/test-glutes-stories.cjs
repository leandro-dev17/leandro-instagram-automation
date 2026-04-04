const path = require('path');
const fs = require('fs');
const { generateImage } = require('./lib/kie.cjs');

const OUT_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/test-glutes-stories';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const PROMPTS = [
  {
    name: 'story-1-hip-thrust',
    prompt: 'fitness woman performing hip thrust exercise on padded bench at gym, side view showing glute contraction, gym background with weights rack'
  },
  {
    name: 'story-2-cable-kickback',
    prompt: 'fitness woman performing cable kickback exercise at gym cable machine, full body profile view showing leg extended back, modern bright gym background'
  },
  {
    name: 'story-3-standing-confident',
    prompt: 'fitness woman standing confidently at gym showing toned body, smiling at camera, bright modern gym with large windows background'
  }
];

async function main() {
  console.log('Gerando 3 stories de treino de glúteos...\n');
  for (const p of PROMPTS) {
    const outPath = path.join(OUT_DIR, `${p.name}.png`);
    console.log(`→ Gerando: ${p.name}...`);
    await generateImage(p.prompt, outPath);
    console.log(`  ✅ ${p.name}.png\n`);
  }
  console.log('✅ Pronto! Pasta:', OUT_DIR);
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
