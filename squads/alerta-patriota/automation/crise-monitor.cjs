#!/usr/bin/env node
// crise-monitor.cjs — Marcio Crise
// Detecta crises (2+ noticias urgentes em 6h) e publica extra para VIP+Elite
// Roda via GitHub Actions a cada 2h
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { sendTelegram, horaBRT, dataBRT } = require('./telegram-reporter.cjs');

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL || 'https://alertapatriota.vercel.app';
const CRON_KEY   = process.env.CRON_SECRET;

// ── VERIFICA CRISE VIA API VERCEL (sem dependência do Neon aqui) ───────────
async function verificarCriseViaAPI() {
  try {
    const res = await fetch(`${APP_URL}/api/cron/modo-crise`, {
      headers: { Authorization: `Bearer ${CRON_KEY}` },
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) return { crise: false };
    const data = await res.json();
    return { crise: !!(data.crise || data.modo_crise || data.urgentes >= 2), urgentes: data.urgentes || 0 };
  } catch (e) {
    console.log(`  ⚠️  API modo-crise falhou: ${e.message}`);
    return { crise: false };
  }
}

// ── CARDS EXTRAS para VIP + Elite (via API, mesma usada pelo cron normal) ──
async function gerarCardsVIPElite() {
  const headers = { Authorization: `Bearer ${CRON_KEY}` };
  const [vip, elite] = await Promise.all([
    fetch(`${APP_URL}/api/cron/gerar-card?plano=vip`, { headers, signal: AbortSignal.timeout(60000) })
      .then((r) => r.ok)
      .catch((e) => { console.log(`  ⚠️  gerar-card vip falhou: ${e.message}`); return false; }),
    fetch(`${APP_URL}/api/cron/gerar-card?plano=elite`, { headers, signal: AbortSignal.timeout(60000) })
      .then((r) => r.ok)
      .catch((e) => { console.log(`  ⚠️  gerar-card elite falhou: ${e.message}`); return false; }),
  ]);
  return vip || elite;
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log('Marcio Crise — verificando nivel de alerta... ' + horaBRT() + ' BRT');

  const { crise, urgentes } = await verificarCriseViaAPI();

  if (!crise) {
    console.log('Sistema em modo normal. Nenhuma crise detectada.');
    return;
  }

  console.log('MODO CRISE ATIVADO — ' + urgentes + ' alertas urgentes!');

  await sendTelegram(
    'Modo Crise — Alerta Patriota\n\n' + urgentes + ' alertas urgentes!\n\nVIP+Elite recebem cards.\n\n' + dataBRT() + ' ' + horaBRT() + ' BRT'
  );

  // VIP + Elite → cards visuais
  const ok = await gerarCardsVIPElite();

  if (ok) {
    await sendTelegram('Modo Crise concluido — cards enviados para VIP+Elite\n' + dataBRT() + ' ' + horaBRT() + ' BRT');
    console.log('Modo crise concluido!');
  } else {
    await sendTelegram('FALHA — Modo Crise — erro ao gerar cards');
    process.exit(1);
  }
}

main().catch(function(err) {
  console.error('Erro:', err.message);
  sendTelegram('Marcio Crise — ERRO: ' + err.message.substring(0, 150)).finally(function() {
    process.exit(1);
  });
});
