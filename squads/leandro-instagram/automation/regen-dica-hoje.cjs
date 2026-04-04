/**
 * regen-dica-hoje.cjs
 * Regenera apenas o reel-dica do dia (imagem de comida + layout).
 * Usa o banco de receitas e o fix de generateFoodImage.
 */

const fs   = require('fs');
const path = require('path');
const os   = require('os');

const { generateFoodImage }  = require('./lib/kie.cjs');
const { recipeDicaReel, renderHTML } = require('./lib/renderer.cjs');
const { getNextRecipe, getBankStatus } = require('./lib/recipe-manager.cjs');

const ONEDRIVE_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const TEMP_DIR     = path.join(__dirname, 'temp');

function today() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const dateStr = today();
  const outDir  = path.join(ONEDRIVE_DIR, dateStr);

  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }

  const receita = getNextRecipe();
  const status  = getBankStatus();
  console.log(`\n🍽️  Receita selecionada: ${receita.title}`);
  console.log(`📦  Banco: ${status.remaining} receitas restantes no ciclo ${status.current_cycle}\n`);

  const bgPath  = path.join(TEMP_DIR, `dica-bg-${Date.now()}.png`);
  const outPath = path.join(outDir, 'reel-dica.png');

  console.log('📸  Gerando foto da receita via Kie.ai Flux...');
  await generateFoodImage(receita.image_prompt, bgPath);
  console.log('✅  Foto gerada!');

  console.log('🎨  Renderizando layout...');
  const html = recipeDicaReel(receita, bgPath);
  await renderHTML(html, outPath, 1080, 1920);

  if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);

  console.log(`\n✅  reel-dica.png salvo em:`);
  console.log(`   ${outPath}`);
  console.log(`\nReceita: ${receita.title}`);
  console.log(`Categoria: ${receita.category}`);
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
