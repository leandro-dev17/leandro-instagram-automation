#!/usr/bin/env node
/**
 * whatsapp-termometro.cjs — Tereza Termômetro
 * Gera e envia o "Termômetro da Liberdade" todo domingo às 20h BRT
 * Roda via GitHub Actions (cron: '0 23 * * 0' = 23h UTC = 20h BRT)
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const Anthropic = require('@anthropic-ai/sdk');
const { sendTelegram, horaBRT, dataBRT } = require('./telegram-reporter.cjs');

const EVO_URL  = process.env.EVOLUTION_API_URL;
const EVO_KEY  = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || 'alertapatriota';

const GROUP_IDS = {
  vip:      process.env.WPP_GROUP_VIP,
  elite:    process.env.WPP_GROUP_ELITE,
};

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── GERAÇÃO DO TERMÔMETRO ──────────────────────────────────────────────────
async function gerarTermometro() {
  const hoje = new Date().toLocaleDateString('pt-BR', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'America/Sao_Paulo',
  });

  const prompt = `Você é o Prof. Dr. Bernardo Cavalcanti, analista político global formado pela USP.

Gere o "Termômetro da Liberdade" desta semana no Brasil. Use EXATAMENTE este formato:

🌡️ *TERMÔMETRO DA LIBERDADE*
_${hoje}_

[2 linhas de contextualização da semana política brasileira — concisas e impactantes]

🟢 *Liberdade Econômica* — X.X/10
[2 linhas sobre economia e mercado desta semana]

🟡 *Soberania Nacional* — X.X/10
[2 linhas sobre soberania, relações externas desta semana]

🔴 *Ameaça Institucional* — ALTA / MÉDIA / BAIXA
[2 linhas sobre ameaças ao Estado de Direito e conservadorismo]

🟢 *Agenda Conservadora* — X.X/10
[2 linhas sobre vitórias ou derrotas conservadoras no legislativo/executivo]

📊 *TEMPERATURA GERAL DA SEMANA: [🟢 FAVORÁVEL / 🟡 MODERADA / 🔴 CRÍTICA]*
[1 linha de conclusão analítica]

_"[frase reflexiva e impactante do Prof. Cavalcanti sobre a semana — máximo 20 palavras]"_

─────────────────────
📲 *Receba análises como essa todos os dias:*
alertapatriota.vercel.app

Responda APENAS com o texto acima. Sem introduções, sem explicações extras.`;

  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 900,
    messages: [{ role: 'user', content: prompt }],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
}

// ── ENVIO WPP ─────────────────────────────────────────────────────────────
async function enviarTextoWPP(groupJid, texto) {
  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({ number: groupJid, textMessage: { text: texto } }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.log(`  ⚠️  sendText ${res.status}: ${err.substring(0, 100)}`);
  }
  return res.ok;
}

// ── MAIN ──────────────────────────────────────────────────────────────────
async function main() {
  const diaSemana = new Date().toLocaleDateString('en-US', { weekday: 'long', timeZone: 'America/Sao_Paulo' });
  if (diaSemana !== 'Sunday' && !process.argv.includes('--forcar')) {
    console.log(`⏭️  Termômetro só roda aos domingos. Hoje: ${diaSemana}`);
    return;
  }

  console.log('🌡️  Tereza Termômetro — Gerando Termômetro da Liberdade...');

  const textoCompleto = await gerarTermometro();
  if (!textoCompleto) {
    await sendTelegram(`❌ *Tereza Termômetro* falhou\nClaude não gerou o conteúdo\n🕐 ${horaBRT()} BRT`);
    process.exit(1);
  }

  // VIP e Elite → versão COMPLETA
  const envios = [
    { plano: 'vip',      jid: GROUP_IDS.vip,    texto: textoCompleto, label: 'completa' },
    { plano: 'elite',    jid: GROUP_IDS.elite,  texto: textoCompleto, label: 'completa' },
  ];

  console.log('📤 Enviando versão completa para VIP+Elite...');
  let enviados = 0;
  const erros = [];

  for (const { plano, jid, texto, label } of envios) {
    if (!jid) continue;
    const ok = await enviarTextoWPP(jid, texto);
    if (ok) { console.log(`  ✅ ${plano} (${label})`); enviados++; }
    else    { console.log(`  ❌ ${plano}: falha`);      erros.push(plano); }
    await new Promise(r => setTimeout(r, 2000));
  }

  const status = erros.length === 0
    ? `✅ 2/2 grupos (VIP+Elite=completo)`
    : `⚠️ ${enviados}/2 grupos (falhou: ${erros.join(', ')})`;

  await sendTelegram(`🌡️ *Termômetro da Liberdade* — domingo\n${status}\n📅 ${dataBRT()} · ${horaBRT()} BRT`);

  console.log(`\n✅ Termômetro enviado para ${enviados}/2 grupos!`);
}

main().catch(async err => {
  console.error('❌ Erro:', err.message);
  await sendTelegram(`❌ *Tereza Termômetro* — ERRO CRÍTICO\n${err.message.substring(0, 150)}`);
  process.exit(1);
});
