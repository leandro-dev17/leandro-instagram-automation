#!/usr/bin/env node
'use strict';

/**
 * agente-pool-kling.cjs — Monitor e Gerador do Pool de Vídeos Kling
 *
 * Roda toda quarta-feira às 10:00 BRT.
 * Verifica quantos vídeos "frescos" existem no pool (não usados nos últimos 14 dias).
 * Se < 4 vídeos frescos → aciona generate-pool-video.cjs para gerar novos.
 *
 * Pool saudável: >= 6 vídeos frescos (janela de 2 semanas sem repetição)
 * Pool crítico: < 4 frescos → gera imediatamente
 * Pool OK: >= 6 frescos → sem ação
 */

const fs   = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

(function loadEnv() {
  const dirs = [__dirname, path.join(__dirname, '..'), path.join(__dirname, '../..')];
  for (const dir of dirs) {
    const ep = path.join(dir, '.env');
    if (!fs.existsSync(ep)) continue;
    for (const line of fs.readFileSync(ep, 'utf8').split('\n')) {
      const [k, ...v] = line.split('=');
      if (k && k.trim() && !k.trim().startsWith('#')) process.env[k.trim()] = v.join('=').trim();
    }
    break;
  }
})();

const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID      = process.env.TELEGRAM_CHAT_ID;
const POOL_DIR     = path.join(__dirname, 'kling-pool');
const TRACKING_FILE = path.join(__dirname, 'logs', 'published-posts.json');
const GENERATOR    = path.join(__dirname, 'generate-pool-video.cjs');

const JANELA_DIAS   = 14;  // Dias sem repetição
const LIMITE_CRITICO = 4;  // Gera quando frescos < 4
const LIMITE_IDEAL   = 6;  // Pool saudável

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

function getVideosPool() {
  if (!fs.existsSync(POOL_DIR)) return [];
  return fs.readdirSync(POOL_DIR)
    .filter(f => f.endsWith('.mp4'))
    .map(f => ({ id: f.replace('.mp4', ''), file: f }));
}

function getUsadosUltimos14Dias() {
  const usados = new Set();
  if (!fs.existsSync(TRACKING_FILE)) return usados;

  try {
    const tracking = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
    const corte    = new Date(Date.now() - JANELA_DIAS * 24 * 3600 * 1000);

    for (const [dateStr, posts] of Object.entries(tracking)) {
      if (new Date(dateStr) < corte) continue;
      const videoId = posts['kling-reel']?.videoId;
      if (videoId) usados.add(videoId);
    }
  } catch { /* ignora */ }

  return usados;
}

async function gerarNovoVideo(idDesejado) {
  if (!fs.existsSync(GENERATOR)) {
    console.warn('generate-pool-video.cjs não encontrado — gerando manualmente via kling-publisher');
    return false;
  }

  console.log(`[agente-pool-kling] Gerando novo vídeo: ${idDesejado || 'automático'}...`);
  try {
    const args = idDesejado ? [GENERATOR, idDesejado] : [GENERATOR];
    execFileSync(process.execPath, args, {
      stdio:   'inherit',
      timeout: 10 * 60 * 1000, // 10 minutos para gerar vídeo
      cwd:     __dirname,
    });
    return true;
  } catch (err) {
    console.warn('Gerador falhou:', err.message);
    return false;
  }
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[agente-pool-kling] Verificando pool — ${data}`);

  const todosVideos = getVideosPool();
  const usadosRecentes = getUsadosUltimos14Dias();
  const frescos = todosVideos.filter(v => !usadosRecentes.has(v.id));

  console.log(`Pool total: ${todosVideos.length} | Usados (14d): ${usadosRecentes.size} | Frescos: ${frescos.length}`);

  // Lista todos os vídeos com status
  const linhasStatus = todosVideos.map(v => {
    const fresco = !usadosRecentes.has(v.id);
    return `${fresco ? '🟢' : '🔴'} ${v.id}`;
  }).join('\n');

  if (frescos.length >= LIMITE_IDEAL) {
    console.log(`✅ Pool saudável (${frescos.length} frescos). Nenhuma ação necessária.`);
    // Só envia alerta se estiver perto do limite
    if (frescos.length <= LIMITE_IDEAL + 1) {
      await enviarTelegram(
        `🎬 <b>Pool Kling — ${data}</b>\n\n` +
        `Pool OK mas próximo do limite:\n` +
        `• Total: ${todosVideos.length} vídeos\n` +
        `• Frescos: ${frescos.length} (mín recomendado: ${LIMITE_IDEAL})\n` +
        `• Usados (últimos ${JANELA_DIAS}d): ${usadosRecentes.size}\n\n` +
        linhasStatus
      );
    }
    return;
  }

  // Pool baixo — alerta imediato
  const mensagemBase =
    `🎬 <b>Pool Kling — ${frescos.length < LIMITE_CRITICO ? '🔴 CRÍTICO' : '🟡 Atenção'}</b>\n\n` +
    `• Total: ${todosVideos.length} vídeos\n` +
    `• Frescos: ${frescos.length} (mínimo: ${LIMITE_CRITICO})\n` +
    `• Usados (últimos ${JANELA_DIAS}d): ${usadosRecentes.size}\n\n` +
    linhasStatus;

  if (frescos.length < LIMITE_CRITICO) {
    await enviarTelegram(mensagemBase + '\n\n🔄 Acionando gerador de vídeos...');

    const quantidadeGerar = LIMITE_IDEAL - frescos.length;
    let gerados = 0;

    for (let i = 0; i < quantidadeGerar; i++) {
      const ok = await gerarNovoVideo(null);
      if (ok) gerados++;
      else break;
      // Intervalo entre gerações (API rate limit)
      if (i < quantidadeGerar - 1) await new Promise(r => setTimeout(r, 5000));
    }

    await enviarTelegram(
      `🎬 <b>Pool Kling — geração concluída</b>\n\n` +
      (gerados > 0
        ? `✅ ${gerados} vídeo(s) gerado(s) com sucesso.`
        : `⚠️ Gerador não disponível neste ambiente.\nGere manualmente: <code>node generate-pool-video.cjs</code>`)
    );
  } else {
    // Entre LIMITE_CRITICO e LIMITE_IDEAL — só alerta
    await enviarTelegram(
      mensagemBase +
      '\n\n⚠️ Considere gerar novos vídeos em breve:\n' +
      '<code>node generate-pool-video.cjs</code>'
    );
  }
}

main().catch(err => {
  console.error('ERRO FATAL agente-pool-kling:', err.message);
  process.exit(1);
});
