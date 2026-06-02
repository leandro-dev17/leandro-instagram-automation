#!/usr/bin/env node
/**
 * crise-monitor.cjs — Márcio Crise
 * Detecta crises (2+ notícias urgentes em 6h) e publica extra para VIP+Elite
 * FOMO de texto para Básico+Patriota
 * Roda via GitHub Actions a cada 2h (cron: '0 */2 * * *')
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { spawnSync } = require('child_process');
const { sendTelegram, horaBRT, dataBRT } = require('./telegram-reporter.cjs');

const APP_URL    = process.env.NEXT_PUBLIC_APP_URL || 'https://alertapatriota.vercel.app';
const CRON_KEY   = process.env.CRON_SECRET;
const EVO_URL    = process.env.EVOLUTION_API_URL;
const EVO_KEY    = process.env.EVOLUTION_API_KEY;
const EVO_INST   = process.env.EVOLUTION_INSTANCIA || 'alertapatriota';
const JID_BASICO   = process.env.WPP_GROUP_BASICO;
const JID_PATRIOTA = process.env.WPP_GROUP_PATRIOTA;

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

// ── FOMO TEXTO para Básico + Patriota ─────────────────────────────────────
async function enviarFOMO(jid) {
  const msg = '🚨 *MODO CRISE — Alerta Patriota*\n\nSituação política grave agora.\n\nMembros VIP e Elite acompanham em tempo real com análise do Capitão Braga — atualização a cada hora.\n\n🔥 Faça upgrade para acompanhar ao vivo:\n👉 alertapatriota.vercel.app';
  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
      body: JSON.stringify({ number: jid, textMessage: { text: msg } }),
    });
    return res.ok;
  } catch { return false; }
}

// ── CARDS EXTRAS para VIP + Elite ─────────────────────────────────────────
function gerarCardsVIPElite() {
  const result = spawnSync('node', ['whatsapp-cards.cjs', 'vip', 'elite'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: Object.assign({}, process.env),
    timeout: 300000,
  });
  return result.status === 0;
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
    'Modo Crise — Alerta Patriota\n\n' + urgentes + ' alertas urgentes!\n\nVIP+Elite recebem cards.\nBasico+Patriota recebem FOMO.\n\n' + dataBRT() + ' ' + horaBRT() + ' BRT'
  );

  // Básico + Patriota → FOMO
  for (const jid of [JID_BASICO, JID_PATRIOTA]) {
    if (!jid) continue;
    const ok = await enviarFOMO(jid);
    console.log((ok ? 'OK' : 'FALHA') + ' FOMO ' + jid);
    await new Promise(function(r) { setTimeout(r, 2000); });
  }

  // VIP + Elite → cards visuais
  const ok = gerarCardsVIPElite();

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
