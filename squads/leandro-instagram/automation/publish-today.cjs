/**
 * publish-today.cjs — Publica todos os conteúdos do dia atual em sequência
 * Pula itens já publicados automaticamente.
 *
 * Novo cronograma:
 *   07:00 — Story (5 slides)       → story-publisher-new.cjs
 *   12:00 — Carrossel (7 slides)   → carousel-publisher.cjs
 *   17:30 — Reel Dica do Personal  → reel-publisher.cjs 6
 *   20:00 — Reel Kling (desabilitado até API liberar)
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const DATE     = process.argv[2] || new Date().toISOString().slice(0, 10);
const TRACKING = path.join(__dirname, 'logs/published-posts.json');

function isPublished(key) {
  try {
    const t = JSON.parse(fs.readFileSync(TRACKING, 'utf8'));
    const e = t[DATE] || {};
    return !!(e[key]);
  } catch { return false; }
}

function run(cmd, label) {
  if (isPublished(label.key)) {
    console.log(`  ⏭️  ${label.name} já publicado — pulando`);
    return;
  }
  console.log(`\n⏳ Publicando ${label.name}...`);
  try {
    execSync(cmd, { cwd: __dirname, stdio: 'inherit', timeout: 10 * 60 * 1000 });
    console.log(`✅ ${label.name} OK`);
  } catch (err) {
    console.log(`❌ ${label.name} falhou: ${(err.message || '').slice(0, 100)}`);
  }
}

async function main() {
  console.log(`\n${'═'.repeat(55)}`);
  console.log(`📅 Publicando conteúdo de ${DATE}`);
  console.log('═'.repeat(55));

  // 07:00 — Story (5 slides)
  run(`node story-publisher-new.cjs ${DATE}`, { key: 'story-new-1', name: 'Story (5 slides)' });

  // 12:00 — Carrossel (7 slides)
  run(`node carousel-publisher.cjs ${DATE}`, { key: 'carousel', name: 'Carrossel (7 slides)' });

  // 17:30 — Reel Dica do Personal
  run(`node reel-publisher.cjs 6 ${DATE}`, { key: 'reel-6', name: 'Reel Dica do Personal' });

  // Status final
  console.log(`\n${'═'.repeat(55)}`);
  let tracking = {};
  try { tracking = JSON.parse(fs.readFileSync(TRACKING, 'utf8')); } catch {}
  const e = tracking[DATE] || {};

  const storyOk    = Array.from({ length: 5 }, (_, i) => e[`story-new-${i + 1}`]).some(Boolean) ? '✅' : '❌';
  const carouselOk = e['carousel']  ? '✅' : '❌';
  const dicaOk     = (e['reel-6'] || e['reel-dica']) ? '✅' : '❌';
  const klingOk    = e['kling']     ? '✅' : '⏸️ (aguardando API)';

  console.log(`${DATE}`);
  console.log(`  Story (5 slides):     ${storyOk}`);
  console.log(`  Carrossel (7 slides): ${carouselOk}`);
  console.log(`  Reel Dica 17:30:      ${dicaOk}`);
  console.log(`  Reel Kling 20:00:     ${klingOk}`);
  console.log('═'.repeat(55));
}

main().catch(err => { console.error('ERRO:', err); process.exit(1); });
