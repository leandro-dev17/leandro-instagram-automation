/**
 * merge-bank.cjs — Junta todos os batches no recipe-bank.json principal
 */
const fs   = require('fs');
const path = require('path');

const DIR        = __dirname;
const BANK_PATH  = path.join(DIR, 'recipe-bank.json');

// Carrega o banco atual
const bank = JSON.parse(fs.readFileSync(BANK_PATH, 'utf8'));
const existingIds = new Set(bank.recipes.map(r => r.id));
let added = 0;

// Encontra todos os arquivos batch-*.json
const batches = fs.readdirSync(DIR)
  .filter(f => f.startsWith('batch-') && f.endsWith('.json'))
  .sort();

for (const file of batches) {
  const recipes = JSON.parse(fs.readFileSync(path.join(DIR, file), 'utf8'));
  for (const recipe of recipes) {
    if (!existingIds.has(recipe.id)) {
      bank.recipes.push(recipe);
      existingIds.add(recipe.id);
      added++;
    } else {
      console.log(`  ⚠ Duplicado ignorado: ${recipe.id}`);
    }
  }
  console.log(`✅ ${file} processado`);
}

bank.version = (bank.version || 1) + 1;
fs.writeFileSync(BANK_PATH, JSON.stringify(bank, null, 2));

console.log(`\n✅ Banco atualizado!`);
console.log(`   Total de receitas: ${bank.recipes.length}`);
console.log(`   Novas adicionadas: ${added}`);
