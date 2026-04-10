/**
 * test-kling.cjs — Testa a geração de vídeo Image-to-Video via Kling AI
 *
 * Pré-requisito: ter uma imagem PNG na pasta de teste para usar como base.
 * Se não tiver, gera uma nova via Kie.ai antes de mandar para o Kling.
 *
 * Uso: node test-kling.cjs
 */

'use strict';

const path = require('path');
const fs   = require('fs');

// Carrega .env
const ENV_PATH = path.join(__dirname, '../.env');
for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
  const [k, ...v] = line.split('=');
  if (k && k.trim() && !k.trim().startsWith('#')) {
    process.env[k.trim()] = v.join('=').trim();
  }
}

const { generateVideo } = require('./lib/kling.cjs');
const { generateImage }  = require('./lib/kie.cjs');

const OUT_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/teste-kling';
if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

const IMAGE_PATH = path.join(OUT_DIR, 'base-image.png');
const VIDEO_PATH = path.join(OUT_DIR, 'reel-kling-test.mp4');

async function main() {
  console.log('\n🎬 Teste Kling AI — Image-to-Video (10 segundos)');
  console.log('─'.repeat(55));

  // Passo 1: imagem base
  if (fs.existsSync(IMAGE_PATH)) {
    console.log(`\n→ Usando imagem existente: ${IMAGE_PATH}`);
  } else {
    console.log('\n→ Gerando imagem base via Kie.ai...');
    await generateImage('fitness woman standing confidently in gym', IMAGE_PATH);
    console.log('  ✅ Imagem gerada\n');
  }

  // Passo 2: gera vídeo
  if (fs.existsSync(VIDEO_PATH)) {
    console.log(`→ Vídeo já existe: ${VIDEO_PATH}`);
    console.log('  (delete o arquivo para gerar novamente)');
    return;
  }

  console.log('\n→ Enviando para Kling AI (Image-to-Video 10s)...');
  console.log('  Aguarde ~2-5 minutos para processamento...\n');

  const t0 = Date.now();
  await generateVideo(IMAGE_PATH, VIDEO_PATH);
  const elapsed = Math.round((Date.now() - t0) / 1000);

  console.log('\n' + '─'.repeat(55));
  console.log(`✅ Vídeo gerado em ${elapsed}s!`);
  console.log(`   ${VIDEO_PATH}`);
  console.log('\nAbra o arquivo MP4 e verifique:');
  console.log('  ✓ Mulher fitness com movimento natural');
  console.log('  ✓ Cabelo e respiração visíveis');
  console.log('  ✓ Duração de 10 segundos');
  console.log('  ✓ Qualidade adequada para Instagram Reel');
}

main().catch(err => {
  console.error('\n💥 ERRO:', err.message);
  process.exit(1);
});
