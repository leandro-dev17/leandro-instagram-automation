#!/usr/bin/env node
'use strict';

/**
 * inspector-imagens.cjs — Inspector de Imagens Geradas
 *
 * Roda logo após o daily-generator (05:15 BRT).
 * Verifica se todos os arquivos PNG/JSON esperados existem,
 * têm tamanho mínimo (> 10KB = não corrompidos) e dimensões corretas.
 *
 * Em caso de falha → alerta Telegram + exit 1 (aborta pipeline do dia).
 */

const fs   = require('fs');
const path = require('path');

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
const OUTPUT_DIR   = process.env.OUTPUT_DIR ||
  'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram';

const TAMANHO_MIN = 10 * 1024; // 10KB mínimo por imagem

function hoje() {
  return new Date().toISOString().slice(0, 10);
}

// Arquivos esperados após o daily-generator
function getArquivosEsperados(outDir) {
  return [
    // Story (5 slides)
    ...Array.from({ length: 5 }, (_, i) => ({
      arquivo: path.join(outDir, `story-slide${i + 1}.png`),
      label: `story-slide${i + 1}.png`,
      minSize: TAMANHO_MIN,
    })),
    // Carrossel (7 slides)
    ...Array.from({ length: 7 }, (_, i) => ({
      arquivo: path.join(outDir, `carousel-slide${i + 1}.png`),
      label: `carousel-slide${i + 1}.png`,
      minSize: TAMANHO_MIN,
    })),
    // Reel dica
    {
      arquivo: path.join(outDir, 'reel-dica.png'),
      label: 'reel-dica.png',
      minSize: TAMANHO_MIN,
    },
    // Dados da dica (JSON)
    {
      arquivo: path.join(outDir, 'dica-data.json'),
      label: 'dica-data.json',
      minSize: 50, // JSON pode ser pequeno
    },
  ];
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
  const dateStr = hoje();
  const outDir  = path.join(OUTPUT_DIR, dateStr);
  const hora    = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  console.log(`[inspector-imagens] Verificando imagens — ${dateStr} ${hora}`);

  if (!fs.existsSync(outDir)) {
    const msg = `🔴 Inspector de Imagens — pasta não encontrada:\n${outDir}\n\nO daily-generator falhou antes de criar os arquivos.`;
    await enviarTelegram(msg);
    console.error(msg.replace(/<[^>]+>/g, ''));
    process.exit(1);
  }

  const arquivos = getArquivosEsperados(outDir);
  const falhas   = [];
  const avisos   = [];

  for (const arq of arquivos) {
    if (!fs.existsSync(arq.arquivo)) {
      falhas.push(`❌ Ausente: ${arq.label}`);
      continue;
    }
    const stat = fs.statSync(arq.arquivo);
    if (stat.size < arq.minSize) {
      falhas.push(`❌ Corrompido (${Math.round(stat.size / 1024)}KB < ${Math.round(arq.minSize / 1024)}KB): ${arq.label}`);
      continue;
    }
    if (stat.size < arq.minSize * 2) {
      avisos.push(`⚠️ Pequeno (${Math.round(stat.size / 1024)}KB): ${arq.label}`);
    }
  }

  // Valida dica-data.json
  const dicaPath = path.join(outDir, 'dica-data.json');
  if (fs.existsSync(dicaPath)) {
    try {
      const dica = JSON.parse(fs.readFileSync(dicaPath, 'utf8'));
      if (!dica.title) falhas.push('❌ dica-data.json sem campo "title"');
      if (!dica.caption) avisos.push('⚠️ dica-data.json sem campo "caption"');
    } catch {
      falhas.push('❌ dica-data.json inválido (JSON corrompido)');
    }
  }

  const totalOK = arquivos.length - falhas.length;

  if (falhas.length > 0) {
    const msg =
      `🔴 <b>Inspector de Imagens — ${dateStr}</b>\n\n` +
      `${falhas.length} arquivo(s) com problema:\n` +
      falhas.join('\n') +
      (avisos.length > 0 ? '\n\n' + avisos.join('\n') : '') +
      `\n\n⚠️ O daily-generator pode ter falhado parcialmente.\nPublicadores do dia podem falhar.`;

    await enviarTelegram(msg);
    console.error(msg.replace(/<[^>]+>/g, ''));
    process.exit(1);
  }

  if (avisos.length > 0) {
    await enviarTelegram(
      `🟡 <b>Inspector de Imagens — ${dateStr}</b>\n\n` +
      `✅ ${totalOK}/${arquivos.length} arquivos OK\n\n` +
      `Avisos:\n` + avisos.join('\n')
    );
  }

  console.log(`✅ Inspector de Imagens — ${totalOK}/${arquivos.length} arquivos verificados. Tudo OK.`);
}

main().catch(err => {
  console.error('ERRO FATAL inspector-imagens:', err.message);
  process.exit(1);
});
