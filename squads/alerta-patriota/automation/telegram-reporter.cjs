#!/usr/bin/env node
'use strict';

/**
 * telegram-reporter.cjs — Utilitário central de notificações Telegram
 * Usado por todos os scripts de automação do Alerta Patriota
 * Requer: TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID no ambiente
 */

async function sendTelegram(message) {
  const token  = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) {
    console.log('  ⚠️  Telegram não configurado (TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID ausentes)');
    return false;
  }
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id:                  chatId,
        text:                     message,
        parse_mode:               'Markdown',
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => '');
      console.log(`  ⚠️  Telegram ${res.status}: ${err.substring(0, 120)}`);
    }
    return res.ok;
  } catch (e) {
    console.log(`  ⚠️  Telegram falhou: ${e.message}`);
    return false;
  }
}

// Hora BRT formatada
function horaBRT() {
  return new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
}

function dataBRT() {
  return new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'America/Sao_Paulo' });
}

module.exports = { sendTelegram, horaBRT, dataBRT };
