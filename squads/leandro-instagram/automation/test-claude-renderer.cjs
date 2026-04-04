/**
 * test-claude-renderer.cjs
 * Testa as 3 abordagens do Claude Renderer gerando 3 posts de exemplo.
 */

const fs = require('fs');
const path = require('path');
const { generateImage } = require('./lib/kie.cjs');
const { renderHTML } = require('./lib/renderer.cjs');
const { generateFullHTML, chooseAndCustomizeTemplate, refineHTML, generateSmartHTML } = require('./lib/claude-renderer.cjs');

const TEMP_DIR = path.join(__dirname, 'temp');
const OUT_DIR  = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/test-claude-renderer';

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function ensureDir(d) { if (!fs.existsSync(d)) fs.mkdirSync(d, { recursive: true }); }

const TEST_POSTS = [
  {
    type: 'motivacional',
    headline: 'Seu bumbum pode SIM mudar de forma!',
    accent: 'SIM',
    body: 'Consistência, treino certo e alimentação estratégica. É ciência, não sorte.',
    cta: '💬 Me conta: há quanto tempo você treina glúteos sem resultado?',
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, toned athletic body with curvy round glutes, standing confidently in modern gym, wearing navy blue high-waist leggings and matching sports bra, back facing camera showing well-defined glutes and legs, looking over shoulder with confident smile, full length from head to toe, warm amber gym lighting, hyperrealistic photography, 8K'
  },
  {
    type: 'educativo',
    headline: 'Periodização para glúteos: como ESTRUTURAR seu treino',
    accent: 'ESTRUTURAR',
    body: 'Sem estrutura, você treina no aleatório. Hip thrust + abdução + agachamento = resultado.',
    cta: '💾 Salva esse post e manda para sua colega de treino!',
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, toned body with round glutes, standing in gym with hands on waist, smiling confidently at camera, wearing coordinated coral and black workout outfit, full length from head to toe, gym mirrors and equipment in background, warm soft lighting, hyperrealistic photography, 8K'
  },
  {
    type: 'cientifico',
    headline: 'A CIÊNCIA da hipertrofia do glúteo',
    accent: 'CIÊNCIA',
    body: 'Tensão mecânica + dano muscular + estresse metabólico. Entenda os 3 pilares!',
    cta: '🔬 Qual pilar você mais negligencia no seu treino?',
    image_prompt: 'Full body shot of a beautiful Brazilian fitness woman, 27 years old, very fit feminine body with prominent round glutes, performing squat with barbell, wearing dark navy high-waist leggings and navy sports bra, side view showing entire female body, gym with squat rack background, dramatic cinematic lighting, hyperrealistic photography, 8K'
  }
];

async function main() {
  log('═══════════════════════════════════════════');
  log('Teste das 3 Abordagens — Claude Renderer');
  log('═══════════════════════════════════════════');

  ensureDir(TEMP_DIR);
  ensureDir(OUT_DIR);

  for (let i = 0; i < TEST_POSTS.length; i++) {
    const post = TEST_POSTS[i];
    log('');
    log(`📱 POST ${i + 1} — ${post.type.toUpperCase()}`);

    // Gera imagem de fundo
    const bgPath = path.join(TEMP_DIR, `test-bg-${i + 1}-${Date.now()}.png`);
    log('   Gerando imagem (Kie.ai Flux)...');
    await generateImage(post.image_prompt, bgPath);
    log('   ✅ Imagem gerada');

    // ── ABORDAGEM 1: HTML completo (só para motivacional)
    if (post.type === 'motivacional') {
      log('   🧠 Abordagem 1: Claude gerando HTML completo...');
      try {
        const html1 = await generateFullHTML(post, bgPath, 'post');
        await renderHTML(html1, path.join(OUT_DIR, `post-${i+1}-abordagem1.png`));
        log('   ✅ Abordagem 1 salva: post-' + (i+1) + '-abordagem1.png');
      } catch (e) { log('   ❌ Abordagem 1 falhou: ' + e.message); }
    }

    // ── ABORDAGEM 2: Claude escolhe template + customiza
    log('   🎨 Abordagem 2: Claude escolhendo template...');
    try {
      const { html: html2, choice } = await chooseAndCustomizeTemplate(post, bgPath, 'post');
      await renderHTML(html2, path.join(OUT_DIR, `post-${i+1}-abordagem2.png`));
      log(`   ✅ Abordagem 2 salva: template=${choice.template}, cores=${choice.tagColor}`);
    } catch (e) { log('   ❌ Abordagem 2 falhou: ' + e.message); }

    // ── ABORDAGEM 3: Refinamento do template padrão
    log('   ✨ Abordagem 3: Refinando template padrão...');
    try {
      const { singlePost } = require('./lib/renderer.cjs');
      const baseHTML = singlePost(post, bgPath);
      const refinedHTML = await refineHTML(baseHTML, post);
      await renderHTML(refinedHTML, path.join(OUT_DIR, `post-${i+1}-abordagem3.png`));
      log('   ✅ Abordagem 3 salva: post-' + (i+1) + '-abordagem3.png');
    } catch (e) { log('   ❌ Abordagem 3 falhou: ' + e.message); }

    // ── PIPELINE COMPLETO (1+2+3)
    log('   🚀 Pipeline completo (smart)...');
    try {
      const { html: htmlSmart, strategy } = await generateSmartHTML(post, bgPath, 'post');
      await renderHTML(htmlSmart, path.join(OUT_DIR, `post-${i+1}-smart.png`));
      log(`   ✅ Smart salvo: ${strategy}`);
    } catch (e) { log('   ❌ Smart falhou: ' + e.message); }

    if (fs.existsSync(bgPath)) fs.unlinkSync(bgPath);
  }

  log('');
  log('═══════════════════════════════════════════');
  log('✅ TESTE CONCLUÍDO! Abra a pasta para comparar:');
  log(`   ${OUT_DIR}`);
  log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('ERRO FATAL:', err.message);
  process.exit(1);
});
