"use strict";

/**
 * publish-reel-now.cjs
 * Publica um MP4 específico diretamente no Instagram como Reel
 * Uso: node publish-reel-now.cjs <caminho-do-video.mp4>
 */

const fs   = require('fs');
const path = require('path');

// Carrega .env
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

const { uploadVideo }                                = require('./lib/cloudinary.cjs');
const { publishReel, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { notifyReel }                                 = require('./lib/telegram.cjs');

async function main() {
  const videoPath = process.argv[2];
  if (!videoPath || !fs.existsSync(videoPath)) {
    console.error('Uso: node publish-reel-now.cjs <caminho-do-video.mp4>');
    process.exit(1);
  }

  const sizeMb = (fs.statSync(videoPath).size / 1024 / 1024).toFixed(1);
  console.log('Video:', path.basename(videoPath), `(${sizeMb} MB)`);

  const caption = `Você malha todo dia, come direito... e ainda assim não emagrece?

O problema não está no esforço dentro da academia.
São as 23 horas que você passa fora dela.

O que você come após o treino, como você dorme, o nível de estresse, a hidratação — tudo isso impacta diretamente o seu resultado.

Sua amiga que "emagreceu do nada" não fez milagre. Ela ajustou os detalhes que a maioria ignora.

Se você quer entender o que está travando o seu resultado, me manda uma mensagem. Vamos descobrir juntos! 💬

---
🏋️ Personal Trainer especialista em treino feminino
📍 Avaliação gratuita — link na bio

#treinofeminino #personaltrainer #emagrecimento #vidasaudavel #treino #fitness #academia #dicasdetreino #mulherfitness #resultados #treinamentofuncional #saudeemforma #emagrecer #corpoemforma #treinoduro #fitnessmotivation #treinointeligente #habitos #qualidadedevida #leandropersonall`;

  console.log('\n📤 Upload para Cloudinary...');
  const videoUrl = await uploadVideo(videoPath);
  console.log('  URL:', videoUrl);

  console.log('\n📱 Publicando no Instagram...');
  const env    = loadEnv();
  const token  = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  const postId = await publishReel(videoUrl, caption, token, userId);
  console.log('\n✅ Publicado! Instagram ID:', postId);

  try {
    await notifyReel('kling', 'Treino diário x resultados — as 23h fora da academia', postId, new Date().toISOString().slice(0, 10), null);
  } catch {}
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
