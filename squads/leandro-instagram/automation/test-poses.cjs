/**
 * test-poses.cjs — Gera 20 imagens com as novas poses diversificadas
 */

const path = require('path');
const fs = require('fs');
const { generateImage } = require('./lib/kie.cjs');

const OUT_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/teste-poses';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const NOMES = [
  'pose-01-frente-maos-quadril',
  'pose-02-frente-bracos-cruzados',
  'pose-03-34-virada-45',
  'pose-04-lateral-perfil',
  'pose-05-sentada-banco-frente',
  'pose-06-sentada-perna-cruzada',
  'pose-07-sentada-chao-cruzada',
  'pose-08-agachada-profunda',
  'pose-09-angulo-alto',
  'pose-10-exercicio-halteres',
];

async function main() {
  console.log(`Gerando ${NOMES.length} poses com novo estilo de pele...\n`);

  for (let i = 0; i < NOMES.length; i++) {
    const name = NOMES[i];
    const outPath = path.join(OUT_DIR, `${name}.png`);

    if (fs.existsSync(outPath)) {
      console.log(`  ⏭️  ${name}.png já existe, pulando`);
      continue;
    }

    console.log(`→ [${i + 1}/${NOMES.length}] ${name}...`);
    try {
      await generateImage('fitness woman in gym', outPath);
      console.log(`  ✅ ${name}.png\n`);
    } catch (err) {
      if (err.message.includes('E005') || err.message.includes('sensitive')) {
        console.log(`  ⚠️  E005 bloqueado — pulando ${name}\n`);
      } else {
        console.log(`  ❌ ERRO: ${err.message}\n`);
      }
    }
  }

  const total = fs.readdirSync(OUT_DIR).filter(f => f.endsWith('.png')).length;
  console.log(`\n✅ Concluído! ${total} imagens em:`);
  console.log(`   ${OUT_DIR}`);
}

main().catch(err => { console.error('ERRO FATAL:', err.message); process.exit(1); });
