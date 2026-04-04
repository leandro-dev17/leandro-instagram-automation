/**
 * generate-gluteos.cjs
 * Gera os 5 reels + 3 posts + PUBLICAR.md de glúteos para teste manual.
 * Salva em: Automação Claude post/leandro-instagram/2026-04-01-gluteos/
 */

const fs = require('fs');
const path = require('path');

const { generateImage } = require('./lib/kie.cjs');
const { reelPost, recipeDicaReel, singlePost, renderHTML } = require('./lib/renderer.cjs');

const SCHEDULE_FILE = path.join(__dirname, 'schedule', 'gluteos-test-2026-04-01.json');
const LOGS_DIR      = path.join(__dirname, 'logs');
const TEMP_DIR      = path.join(__dirname, 'temp');
const ONEDRIVE_DIR  = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';
const DATE_KEY      = '2026-04-01-gluteos';
const OUT_DIR       = path.join(ONEDRIVE_DIR, DATE_KEY);

function log(msg) {
  const ts = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  fs.appendFileSync(path.join(LOGS_DIR, 'generator.log'), line + '\n');
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

function buildPublicarMd(dayPlan) {
  const d = dayPlan;
  const lines = [
    `# Conteúdo — TESTE GLÚTEOS 01/04/2026`,
    `**Gerado manualmente por BioNexus Digital para publicação manual**`,
    ``,
    `---`,
    ``,
    `## 🎬 REELS (5 imagens individuais — formato 9:16)`,
    ``,
    `**📌 Hashtags (cole no 1º comentário de cada reel):**`,
    d.reels_hashtags,
    ``,
    `---`,
    ``
  ];

  d.reels.forEach((reel, i) => {
    lines.push(`### Reel ${i + 1} — ${reel.type}`);
    lines.push(`**Arquivo:** reel-0${i + 1}.png`);
    lines.push(`**Headline:** ${reel.headline}`);
    lines.push(`**CTA:** ${reel.cta}`);
    lines.push(``);
  });

  lines.push(`---`, ``);

  d.posts.forEach((post, i) => {
    const label = { motivacional: 'MOTIVACIONAL', educativo: 'EDUCATIVO', cientifico: 'CIENTÍFICO' };
    lines.push(`## POST ${i + 1} — ${label[post.type] || post.type.toUpperCase()}`);
    lines.push(`**Arquivo:** post-${i + 1}-${post.type}.png`);
    lines.push(``);
    lines.push(`### Caption`);
    lines.push(post.caption);
    lines.push(``);
    lines.push(`### Hashtags`);
    lines.push(post.hashtags);
    lines.push(``);
    lines.push(`---`, ``);
  });

  if (d.dica_receita) {
    const r = d.dica_receita;
    lines.push(`## 🍽️ DICA DO PERSONAL — ${r.title}`);
    lines.push(`**Arquivo:** reel-dica.png`);
    lines.push(``);
    lines.push(`### Caption + Receita Completa`);
    lines.push(r.caption);
    lines.push(``);
    lines.push(`### Hashtags`);
    lines.push(r.hashtags);
    lines.push(``);
    lines.push(`---`, ``);
  }

  lines.push(`## ✅ Checklist`);
  lines.push(`- [ ] Reel 1 (motivacional): postar + hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 2 (educativo): postar + hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 3 (científico): postar + hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 4 (dica ativação): postar + hashtags no 1º comentário`);
  lines.push(`- [ ] Reel 5 (mitos): postar + hashtags no 1º comentário`);
  lines.push(`- [ ] Post 1 (motivacional): postar no feed`);
  lines.push(`- [ ] Post 2 (educativo): postar no feed`);
  lines.push(`- [ ] Post 3 (científico): postar no feed`);
  lines.push(`- [ ] Dica do Personal: postar como reel`);
  lines.push(`- [ ] Responder comentários nas primeiras 2h`);
  lines.push(``);
  lines.push(`*Gerado por BioNexus Digital — @leandro_personall*`);

  return lines.join('\n');
}

async function main() {
  log('═══════════════════════════════════════════');
  log('BioNexus Digital — Gerador de Glúteos (Teste)');
  log('═══════════════════════════════════════════');

  ensureDir(TEMP_DIR);
  ensureDir(LOGS_DIR);
  ensureDir(OUT_DIR);

  const schedule = JSON.parse(fs.readFileSync(SCHEDULE_FILE, 'utf8'));
  const dayPlan = schedule.days[DATE_KEY];

  log(`Pasta de saída: ${OUT_DIR}`);
  log('');

  // ── 5 REELS ──────────────────────────────────────────────────────────────────
  log('🎬 REELS (5):');
  for (let i = 0; i < dayPlan.reels.length; i++) {
    const reel = { ...dayPlan.reels[i], number: i + 1 };
    const bgPath = path.join(TEMP_DIR, `reel-bg-${i + 1}-${Date.now()}.png`);

    log(`  → Reel ${i + 1}/5: ${reel.headline}`);
    log(`    Gerando imagem (Kie.ai Flux)...`);
    await generateImage(reel.image_prompt, bgPath);

    const html = reelPost(reel, bgPath);
    const pngName = `reel-0${i + 1}.png`;
    await renderHTML(html, path.join(OUT_DIR, pngName), 1080, 1920);
    log(`    ✅ reel-0${i + 1}.png pronto`);

    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
  }
  log('');

  // ── 3 POSTS FEED ─────────────────────────────────────────────────────────────
  for (let i = 0; i < dayPlan.posts.length; i++) {
    const post = dayPlan.posts[i];
    const bgPath = path.join(TEMP_DIR, `post-bg-${i + 1}-${Date.now()}.png`);

    log(`📱 POST ${i + 1}/3: ${post.type}`);
    log(`   Gerando imagem (Kie.ai Flux)...`);
    await generateImage(post.image_prompt, bgPath);

    const html = singlePost(post, bgPath);
    const pngName = `post-${i + 1}-${post.type}.png`;
    await renderHTML(html, path.join(OUT_DIR, pngName));
    log(`   ✅ post-${i + 1}-${post.type}.png pronto`);

    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
    log('');
  }

  // ── DICA DO PERSONAL ─────────────────────────────────────────────────────────
  if (dayPlan.dica_receita) {
    const dica = dayPlan.dica_receita;
    const bgPath = path.join(TEMP_DIR, `dica-bg-${Date.now()}.png`);

    log('🍽️ DICA DO PERSONAL:');
    log(`   Gerando imagem (Kie.ai Flux)...`);
    await generateImage(dica.image_prompt, bgPath);

    const html = recipeDicaReel(dica, bgPath);
    await renderHTML(html, path.join(OUT_DIR, 'reel-dica.png'), 1080, 1920);
    log(`   ✅ reel-dica.png pronto`);

    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
    log('');
  }

  // ── PUBLICAR.md ──────────────────────────────────────────────────────────────
  const publicarMd = buildPublicarMd(dayPlan);
  fs.writeFileSync(path.join(OUT_DIR, 'PUBLICAR.md'), publicarMd, 'utf8');
  log('📄 PUBLICAR.md gerado');
  log('');
  log('═══════════════════════════════════════════');
  log('✅ TUDO PRONTO! Arquivos em:');
  log(`   ${OUT_DIR}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  log(`ERRO FATAL: ${err.message}`);
  log(err.stack);
  process.exit(1);
});
