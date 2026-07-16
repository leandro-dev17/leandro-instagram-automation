#!/usr/bin/env node
'use strict';

/**
 * fiscal-hooks-kling.cjs — Fiscal de Qualidade dos Hooks do Kling
 *
 * Roda diariamente às 13:30 BRT (16:30 UTC), após o kling publicar (12:00 BRT).
 * Detecta problemas nos hooks de texto que aparecem nos reels:
 *
 * 1. Hook genérico (fallback) — IA falhou → mesmo texto toda vez
 * 2. Linha com mais de 18 chars → texto cortado visualmente no reel
 * 3. Múltiplos runs seguidos usando fallback → problema persistente com a IA
 * 4. Hook sem acentos corretos → texto encoding corrompido
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

const LOGS_DIR      = path.join(__dirname, 'logs');
const TRACKING_FILE = path.join(LOGS_DIR, 'published-posts.json');
const { salvarResultado } = require('./lib/fiscal-resultado.cjs');

// Hooks de fallback conhecidos (gerados quando a IA falha)
const HOOKS_FALLBACK = [
  'Isso vai mudar', 'Os resultados', 'Você ainda nao', 'Ja fez antes',
  'isso vai mudar', 'os resultados', 'você ainda não', 'já fez antes',
];

function ehFallback(hook) {
  if (!hook || !Array.isArray(hook)) return false;
  const primerSegmento = hook[0];
  if (!primerSegmento) return false;
  const l1 = (primerSegmento.l1 || '').toLowerCase();
  return HOOKS_FALLBACK.some(f => l1.includes(f.toLowerCase()));
}

function verificarLinhas(hook) {
  if (!hook || !Array.isArray(hook)) return [];
  const linhasLongas = [];
  hook.forEach((seg, si) => {
    ['l1', 'l2', 'l3'].forEach(k => {
      const linha = seg[k] || '';
      if (linha.length > 18) {
        linhasLongas.push(`Segmento ${si + 1} ${k}: "${linha}" (${linha.length} chars > 18)`);
      }
    });
  });
  return linhasLongas;
}

// Sem envio direto ao Telegram — o guardião aciona o resolver que notifica

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[fiscal-hooks-kling] Auditando qualidade de hooks — ${data}`);

  let tracking = {};
  try {
    tracking = await lerTrackingCompleto(TRACKING_FILE);
  } catch (err) {
    console.warn('Não conseguiu ler tracking:', err.message);
    return; // Não falha o job — só loga
  }

  // Pega últimas 7 entradas com hook
  const klingComHook = Object.entries(tracking)
    .filter(([, p]) => p['kling-reel']?.hook)
    .sort(([a], [b]) => a.localeCompare(b))
    .slice(-7);

  if (klingComHook.length === 0) {
    console.log('Nenhuma entrada kling com hook encontrada no tracking.');
    return;
  }

  const problemas = [];
  const avisos    = [];
  let fallbacksConsecutivos = 0;

  for (const [dia, posts] of klingComHook) {
    const { hook, topic } = posts['kling-reel'];

    // Check 1: hook é fallback?
    if (ehFallback(hook)) {
      fallbacksConsecutivos++;
      avisos.push(`⚠️ ${dia}: hook FALLBACK (IA falhou) — tema: "${(topic || '').slice(0, 40)}"`);
    } else {
      fallbacksConsecutivos = 0; // reset se a IA gerou corretamente
    }

    // Check 2: linhas longas
    const longas = verificarLinhas(hook);
    if (longas.length > 0) {
      longas.forEach(l => problemas.push(`❌ ${dia}: linha longa: ${l}`));
    }
  }

  // Check 3: múltiplos fallbacks consecutivos
  if (fallbacksConsecutivos >= 3) {
    problemas.push(`❌ <b>${fallbacksConsecutivos} runs consecutivos usando hook fallback</b>\nGroq/Cerebras podem estar com problemas persistentes`);
  }

  if (problemas.length === 0 && avisos.length === 0) {
    console.log(`✅ Qualidade OK — ${klingComHook.length} hooks verificados.`);
    return;
  }

  salvarResultado('hooks-kling', problemas, avisos, {
    hooksVerificados: klingComHook.length,
    fallbacksConsecutivos,
    instrucao: 'Verifique se GROQ_API_KEY/CEREBRAS_API_KEY estão válidas. Hook fallback significa que a IA falhou ao gerar o texto do reel.',
  });
  console.log([...problemas, ...avisos].join('\n'));
  if (problemas.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-hooks-kling:', err.message);
  process.exit(1);
});
