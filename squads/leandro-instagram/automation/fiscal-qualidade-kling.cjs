#!/usr/bin/env node
'use strict';

/**
 * fiscal-qualidade-kling.cjs — Fiscal de Qualidade dos Reels Kling
 *
 * Roda diariamente às 18:30 BRT (21:30 UTC), após o kling publicar.
 * Detecta problemas de diversidade ANTES que o usuário note no Instagram:
 *
 * 1. Tracking vazio no GitHub → diversidade de modelos quebrada
 * 2. Mesmo modelo em dias consecutivos → repetição visual
 * 3. Ausência de videoId no tracking → sistema não está salvando corretamente
 * 4. Último kling há mais de 2 dias → kling parando de publicar sem alerta
 */

const fs   = require('fs');
const path = require('path');
const { lerTrackingCompleto } = require('./lib/tracking-github.cjs');

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
const LOGS_DIR     = path.join(__dirname, 'logs');
const TRACKING_FILE = path.join(LOGS_DIR, 'published-posts.json');

// Mapeamento videoId → modelo (para detectar repetição por modelo, não só por ID)
const VIDEO_MODEL_MAP = {
  '01': 'morena-rosa',         '02': 'morena-rosa',         '03': 'morena-rosa',
  '04': 'morena-rosa',         '05': 'morena-rosa',         '06': 'morena-rosa',
  '09': 'morena-rosa',         '10': 'loira-verde',         '11': 'ruiva-lilas',
  '12': 'morena-escura-coral', '13': 'loira-azul',          '14': 'morena-preta',
  '15': 'negra-vermelha',      '16': 'negra-verde',         '17': 'loira-laranja',
  '18': 'ruiva-preta',         '19': 'morena-lilas',        '20': 'negra-azul',
  '21': 'loira-branca',        '22': 'ruiva-amarela',       '23': 'morena-branca',
};

function getModelFromVideoId(videoId) {
  if (!videoId) return null;
  const num = String(videoId).split('-')[0].replace(/^0+/, '') || String(videoId).split('-')[0];
  return VIDEO_MODEL_MAP[num.padStart(2, '0')] || VIDEO_MODEL_MAP[num] || `desconhecido(${num})`;
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[fiscal-qualidade-kling] Auditando diversidade — ${data}`);

  const problemas = [];
  const avisos    = [];

  // Lê tracking do GitHub (fonte de verdade)
  let tracking = {};
  try {
    tracking = await lerTrackingCompleto(TRACKING_FILE);
  } catch (err) {
    await enviarTelegram(`🔴 <b>Fiscal Qualidade Kling</b> — erro ao ler tracking: ${err.message.slice(0, 150)}`);
    process.exit(1);
  }

  // ── CHECK 1: Tracking populado? ───────────────────────────────────────────
  const klingEntries = Object.entries(tracking)
    .filter(([, p]) => p['kling-reel'])
    .sort(([a], [b]) => a.localeCompare(b));

  if (klingEntries.length === 0) {
    problemas.push('❌ <b>Tracking zerado</b> — published-posts.json não tem entradas kling\nDiversidade de modelos está completamente quebrada!');
  } else {
    // ── CHECK 2: Tem videoId? ───────────────────────────────────────────────
    const semVideoId = klingEntries.filter(([, p]) => !p['kling-reel'].videoId);
    if (semVideoId.length > 0) {
      avisos.push(`⚠️ <b>${semVideoId.length} entradas</b> kling sem videoId — sistema de diversidade pode estar comprometido`);
    }

    // ── CHECK 3: Modelo repetido em dias consecutivos ─────────────────────
    const historico = klingEntries.slice(-14).map(([d, p]) => ({
      data:    d,
      videoId: p['kling-reel'].videoId || '?',
      modelo:  getModelFromVideoId(p['kling-reel'].videoId),
    }));

    // Detecta repetições (3 dias seguidos = crítico, 2 dias = aviso)
    for (let i = 1; i < historico.length; i++) {
      const atual   = historico[i];
      const anterior = historico[i - 1];
      if (!atual.modelo || !anterior.modelo || atual.modelo.startsWith('desconhecido')) continue;

      if (atual.modelo === anterior.modelo) {
        // Verifica se os dias são consecutivos
        const diasDif = Math.round((new Date(atual.data) - new Date(anterior.data)) / 86400000);
        if (diasDif <= 2) {
          if (i >= 2 && historico[i - 2].modelo === atual.modelo) {
            problemas.push(`❌ <b>Modelo "${atual.modelo}"</b> repetida 3+ dias:\n${historico[i-2].data}, ${anterior.data}, ${atual.data}`);
          } else {
            avisos.push(`⚠️ Modelo "${atual.modelo}" repetida: ${anterior.data} e ${atual.data}`);
          }
        }
      }
    }

    // ── CHECK 4: Último kling publicado quando? ────────────────────────────
    const ultimoKling     = klingEntries[klingEntries.length - 1];
    const diasDesdeUltimo = Math.floor((Date.now() - new Date(ultimoKling[0]).getTime()) / 86400000);
    if (diasDesdeUltimo > 2) {
      problemas.push(`❌ <b>Kling parado</b> — último publicado há ${diasDesdeUltimo} dias (${ultimoKling[0]})\nVerifique se o job kling-reel-20h está rodando`);
    } else if (diasDesdeUltimo > 1) {
      avisos.push(`⚠️ Kling não publicou ontem (último: ${ultimoKling[0]})`);
    }

    // ── RESUMO dos últimos 7 dias ─────────────────────────────────────────
    const ultimos7  = klingEntries.slice(-7);
    const modelos7  = [...new Set(ultimos7.map(([, p]) => getModelFromVideoId(p['kling-reel'].videoId)).filter(Boolean))];
    console.log(`Últimos ${ultimos7.length} klings | Modelos únicos: ${modelos7.join(', ')}`);
  }

  // ── RESULTADO ─────────────────────────────────────────────────────────────
  if (problemas.length === 0 && avisos.length === 0) {
    console.log('✅ Diversidade OK — nenhum problema detectado.');
    return; // Sem alertas quando tudo está bem (evita spam)
  }

  const icone = problemas.length > 0 ? '🔴' : '🟡';
  const linhas = [...problemas, ...avisos];

  await enviarTelegram(
    `${icone} <b>Fiscal Qualidade Kling — ${data}</b>\n\n` +
    linhas.join('\n\n') +
    (problemas.length > 0
      ? '\n\n🤖 Escalando para Claude Resolver...'
      : '')
  );

  // Problemas críticos → exit 1 para o guardião escalar ao Claude Resolver
  if (problemas.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-qualidade-kling:', err.message);
  process.exit(1);
});
