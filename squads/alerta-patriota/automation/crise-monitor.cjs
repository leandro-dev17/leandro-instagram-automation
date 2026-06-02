#!/usr/bin/env node
/**
 * crise-monitor.cjs — Márcio Crise
 * Detecta crises políticas (2+ notícias urgentes em 6h) e publica card extra
 * Roda via GitHub Actions a cada 2h (cron: '0 */2 * * *')
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { neon }    = require('@neondatabase/serverless');
const { spawnSync } = require('child_process');
const { sendTelegram, horaBRT, dataBRT } = require('./telegram-reporter.cjs');

const sql = neon(process.env.DATABASE_URL);

// ── DETECÇÃO DE CRISE ─────────────────────────────────────────────────────
async function verificarCrise() {
  const rows = await sql`
    SELECT COUNT(*) as total FROM noticias
    WHERE urgente = true
      AND created_at > NOW() - INTERVAL '6 hours'
      AND (
        postada_basico   = false OR
        postada_patriota = false OR
        postada_vip      = false
      )
  `;
  return parseInt(rows[0].total);
}

// Evita disparar crise várias vezes na mesma janela de 2h
async function jaDisparouCriseNaUltimaHora() {
  const rows = await sql`
    SELECT COUNT(*) as total FROM agentes_log
    WHERE agente = 'marcio-crise'
      AND status = 'sucesso'
      AND created_at > NOW() - INTERVAL '1 hour'
  `;
  return parseInt(rows[0].total) > 0;
}

const EVO_URL  = process.env.EVOLUTION_API_URL;
const EVO_KEY  = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || 'alertapatriota';
const GROUP_IDS = {
  basico:   process.env.WPP_GROUP_BASICO,
  patriota: process.env.WPP_GROUP_PATRIOTA,
};

// ── FOMO DE TEXTO para Básico + Patriota ──────────────────────────────────
async function enviarFOMOCrise(groupJid) {
  const msg = `🚨 *MODO CRISE ATIVADO — Alerta Patriota*\n\nSituação política grave se desenvolvendo agora.\n\nOs membros VIP e Elite estão acompanhando em tempo real com análise completa do Capitão Braga — atualização a cada 1 hora.\n\n🔥 Faça upgrade agora para acompanhar ao vivo:\n👉 alertapatriota.vercel.app`;
  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({ number: groupJid, textMessage: { text: msg } }),
  });
  return res.ok;
}

// ── CARDS EXTRAS apenas para VIP + Elite ──────────────────────────────────
function dispararCardsVIPElite() {
  console.log('  🚨 Gerando cards de crise para VIP + Elite...');
  const result = spawnSync('node', ['whatsapp-cards.cjs', 'vip', 'elite'], {
    cwd: __dirname,
    stdio: 'inherit',
    env: { ...process.env },
    timeout: 300_000,
  });
  return result.status === 0;
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  console.log(`🔍 Márcio Crise — verificando nível de alerta... (${horaBRT()} BRT)`);

  const qtd = await verificarCrise();
  console.log(`📊 Notícias urgentes não publicadas nas últimas 6h: ${qtd}`);

  if (qtd < 2) {
    console.log('✅ Sistema em modo normal. Nenhuma crise detectada.');
    return;
  }

  if (await jaDisparouCriseNaUltimaHora()) {
    console.log('⏭️  Modo crise já foi ativado na última hora. Aguardando próxima janela.');
    return;
  }

  console.log(`🚨 MODO CRISE ATIVADO — ${qtd} alertas urgentes!`);

  await sendTelegram(
    `🚨 *MODO CRISE — Alerta Patriota*\n\n${qtd} alertas urgentes nas últimas 6h!\n\n📋 VIP+Elite → cards em tempo real\n📢 Básico+Patriota → mensagem FOMO\n\n📅 ${dataBRT()} · ${horaBRT()} BRT`
  );

  // Básico + Patriota → FOMO de texto (não cards)
  console.log('  📢 Enviando FOMO para Básico + Patriota...');
  for (const [plano, jid] of Object.entries(GROUP_IDS)) {
    if (!jid) continue;
    const ok = await enviarFOMOCrise(jid);
    console.log(`  ${ok ? '✅' : '❌'} FOMO ${plano}`);
    await new Promise(r => setTimeout(r, 2000));
  }

  // VIP + Elite → cards visuais completos
  const ok = dispararCardsVIPElite();

  // Registra no log
  await sql`
    INSERT INTO agentes_log(agente, acao, status, detalhes)
    VALUES('marcio-crise', 'modo_crise', ${ok ? 'sucesso' : 'erro'}, ${JSON.stringify({ qtdUrgentes: qtd, hora: horaBRT() })})
  `;

  if (ok) {
    await sendTelegram(
      `✅ *Modo Crise concluído*\nCards extras enviados para os 4 grupos\n📅 ${dataBRT()} · ${horaBRT()} BRT`
    );
    console.log('\n✅ Modo crise concluído com sucesso!');
  } else {
    await sendTelegram(
      `❌ *Modo Crise FALHOU*\nErro ao gerar cards extras. Verifique os logs do GitHub Actions.\n📅 ${dataBRT()} · ${horaBRT()} BRT`
    );
    process.exit(1);
  }
}

main().catch(async err => {
  console.error('❌ Erro:', err.message);
  await sendTelegram(`❌ *Márcio Crise* — ERRO CRÍTICO\n${err.message.substring(0, 150)}`);
  process.exit(1);
});
