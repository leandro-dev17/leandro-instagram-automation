/**
 * recipe-manager.cjs
 * Gerencia o banco de receitas para o reel-dica.
 * Garante que nenhuma receita se repita até esgotar todo o banco.
 */

const fs = require('fs');
const path = require('path');

const BANK_PATH    = path.join(__dirname, '../recipes/recipe-bank.json');
const TRACKER_PATH = path.join(__dirname, '../recipes/recipe-tracker.json');

function loadBank() {
  return JSON.parse(fs.readFileSync(BANK_PATH, 'utf8'));
}

function loadTracker() {
  if (!fs.existsSync(TRACKER_PATH)) {
    return { used: [], current_cycle: 1 };
  }
  try {
    return JSON.parse(fs.readFileSync(TRACKER_PATH, 'utf8'));
  } catch {
    return { used: [], current_cycle: 1 };
  }
}

function saveTracker(tracker) {
  fs.writeFileSync(TRACKER_PATH, JSON.stringify(tracker, null, 2));
}

/**
 * Retorna a próxima receita não usada.
 * Quando todas forem usadas, reinicia o ciclo (nunca repete na mesma passagem).
 */
function getNextRecipe() {
  const bank    = loadBank();
  const tracker = loadTracker();
  const allIds  = bank.recipes.map(r => r.id);

  // Filtra receitas ainda não usadas neste ciclo
  const available = bank.recipes.filter(r => !tracker.used.includes(r.id));

  if (available.length === 0) {
    // Todas usadas — reinicia o ciclo
    tracker.used         = [];
    tracker.current_cycle = (tracker.current_cycle || 1) + 1;
    console.log(`[recipe-manager] Banco esgotado — iniciando ciclo ${tracker.current_cycle}`);
    available.push(...bank.recipes);
  }

  // Pega a primeira disponível (ordem do banco)
  const recipe = available[0];

  // Marca como usada
  tracker.used.push(recipe.id);
  tracker.last_used = recipe.id;
  tracker.last_used_at = new Date().toISOString();
  saveTracker(tracker);

  return recipe;
}

/**
 * Retorna status atual do banco
 */
function getBankStatus() {
  const bank    = loadBank();
  const tracker = loadTracker();
  const total   = bank.recipes.length;
  const used    = tracker.used.length;
  const remaining = total - used;
  return { total, used, remaining, current_cycle: tracker.current_cycle || 1 };
}

module.exports = { getNextRecipe, getBankStatus };
