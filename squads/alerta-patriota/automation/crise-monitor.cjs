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

// ── DISPARO DOS CARDS EXTRAS ───────────────────────────────────────────────
function dispararCardsExtras() {
  console.log('  🚨 Gerando cards de crise para todos os grupos...');
  const result = spawnSync('node', ['whatsapp-cards.cjs'], {
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

  // Verifica se já disparou crise na última hora (evita spam)
  if (await jaDisparouCriseNaUltimaHora()) {
    console.log('⏭️  Modo crise já foi ativado na última hora. Aguardando próxima janela.');
    return;
  }

  console.log(`🚨 MODO CRISE ATIVADO — ${qtd} alertas urgentes!`);

  await sendTelegram(
    `🚨 *MODO CRISE — Alerta Patriota*\n\n${qtd} alertas urgentes nas últimas 6 horas!\n\nMárcio Crise está disparando publicação extra em todos os grupos agora.\n\n📅 ${dataBRT()} · ${horaBRT()} BRT`
  );

  const ok = dispararCardsExtras();

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
