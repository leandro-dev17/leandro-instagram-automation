/**
 * generate-dica-standalone.cjs
 * Gera apenas o reel-dica do dia (imagem + dica-data.json) sem depender do daily-generator.
 * Usado pelo job reel-dica-1730h no GitHub Actions para ser auto-suficiente.
 *
 * Uso: node generate-dica-standalone.cjs [YYYY-MM-DD]
 */

'use strict';

const fs   = require('fs');
const path = require('path');

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

const { generateFoodImage }  = require('./lib/kie.cjs');
const { recipeDicaReel, renderHTML } = require('./lib/renderer.cjs');
const { getNextRecipe, getBankStatus } = require('./lib/recipe-manager.cjs');

const LOGS_DIR    = path.join(__dirname, 'logs');
const TEMP_DIR    = path.join(__dirname, 'temp');
const OUTPUT_DIR  = process.env.OUTPUT_DIR || 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'generator.log'), line + '\n');
}

function today() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  return new Date().toISOString().slice(0, 10);
}

async function main() {
  const dateStr = today();
  const outDir  = path.join(OUTPUT_DIR, dateStr);

  fs.mkdirSync(outDir,   { recursive: true });
  fs.mkdirSync(TEMP_DIR, { recursive: true });
  fs.mkdirSync(LOGS_DIR, { recursive: true });

  log('═══════════════════════════════════════════');
  log(`generate-dica-standalone — ${dateStr}`);
  log('═══════════════════════════════════════════');

  const dicaDataPath = path.join(outDir, 'dica-data.json');
  const dicaPngPath  = path.join(outDir, 'reel-dica.png');

  // Reutiliza receita do dia se já foi escolhida (evita avançar o ponteiro 2x)
  let recipe;
  if (fs.existsSync(dicaDataPath)) {
    recipe = JSON.parse(fs.readFileSync(dicaDataPath, 'utf8'));
    log(`→ Receita do dia reutilizada: "${recipe.title}" (dica-data.json existente)`);
  } else {
    recipe = getNextRecipe();
    const status = getBankStatus();
    log(`→ Receita do dia: "${recipe.title}" (${status.remaining} restantes no ciclo ${status.current_cycle})`);
    fs.writeFileSync(dicaDataPath, JSON.stringify(recipe, null, 2), 'utf8');
    log(`→ dica-data.json salvo`);
  }

  // Gera imagem se ainda não existe
  if (fs.existsSync(dicaPngPath)) {
    log(`→ reel-dica.png já existe — pulando geração de imagem`);
  } else {
    log('🍽️  Gerando imagem do alimento via Kie.ai...');
    const bgPath = path.join(TEMP_DIR, `dica-bg-${Date.now()}.png`);
    await generateFoodImage(recipe.image_prompt, bgPath);

    log('🎨 Renderizando reel-dica.png via Playwright...');
    const html = recipeDicaReel(recipe, bgPath);
    await renderHTML(html, dicaPngPath, 1080, 1920);

    try { fs.unlinkSync(bgPath); } catch {}
    log(`✅ reel-dica.png gerado: ${dicaPngPath}`);
  }

  log('');
  log('═══════════════════════════════════════════');
  log(`✅ Dica do dia pronta: "${recipe.title}"`);
  log(`   PNG:  ${dicaPngPath}`);
  log(`   Data: ${dicaDataPath}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('ERRO FATAL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
