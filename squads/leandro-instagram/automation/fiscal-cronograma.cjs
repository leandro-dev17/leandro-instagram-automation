#!/usr/bin/env node
'use strict';

/**
 * fiscal-cronograma.cjs — Agente Fiscal de Cronograma (@leandro_personall)
 *
 * Adaptado do gerente-conteudo da Vovó Teresinha.
 * Roda diariamente às 08:30 UTC (05:30 BRT) logo após o daily-generator.
 *
 * Verifica:
 * 1. O plano semanal cobre os próximos 7 dias
 * 2. Hoje tem conteúdo no schedule
 * 3. O recipe-tracker não zerou (receitas disponíveis)
 * 4. O kling-pool tem vídeos (pelo menos 3 frescos)
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

const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const REPO           = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const SCHEDULE_DIR   = path.join(__dirname, 'schedule');
const RECIPES_FILE   = path.join(__dirname, 'recipes', 'recipe-tracker.json');
const KLING_POOL_DIR = path.join(__dirname, 'kling-pool');
const WEEKLY_WF      = 'bionexus-weekly.yml';

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function dispararPlanejadorSemanal() {
  if (!GITHUB_TOKEN) return false;
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WEEKLY_WF}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { task: 'planner' } }),
    }
  );
  return res.ok;
}

function getProximosDias(n) {
  const dias = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    dias.push(d.toISOString().slice(0, 10));
  }
  return dias;
}

function carregarSchedule() {
  if (!fs.existsSync(SCHEDULE_DIR)) return {};
  const dias = {};
  for (const file of fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json'))) {
    try {
      const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
      if (plan.days) Object.assign(dias, plan.days);
    } catch { /* ignora arquivo corrompido */ }
  }
  return dias;
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[fiscal-cronograma] Verificando cronograma — ${data}`);

  const alertas   = [];
  const relatorio = [];

  // ── Cobertura do schedule ────────────────────────────────────────────────
  const proximos = getProximosDias(8); // hoje + 7 dias
  const schedule = carregarSchedule();
  const semCobertura = proximos.filter(d => !schedule[d]);

  if (semCobertura.length === 0) {
    relatorio.push(`✅ Cronograma: cobre os próximos 8 dias`);
  } else if (semCobertura.length <= 2) {
    alertas.push(`🟡 ${semCobertura.length} dia(s) sem cronograma: ${semCobertura.join(', ')}`);
    relatorio.push(`⚠️ Dias sem cobertura: ${semCobertura.join(', ')}`);
  } else {
    alertas.push(`🔴 ${semCobertura.length} dias sem cronograma — planejador semanal ausente!`);
    relatorio.push(`❌ ${semCobertura.length} dias sem cobertura: ${semCobertura.slice(0, 3).join(', ')}...`);
    // Aciona o planejador automaticamente
    console.log('⚠️ Acionando weekly-planner automaticamente...');
    const ok = await dispararPlanejadorSemanal();
    relatorio.push(ok ? `🔄 Weekly-planner acionado automaticamente` : `⚠️ Falha ao acionar weekly-planner`);
  }

  // ── Conteúdo de hoje ─────────────────────────────────────────────────────
  const hoje = new Date().toISOString().slice(0, 10);
  if (schedule[hoje]) {
    const d = schedule[hoje];
    relatorio.push(
      `✅ Hoje tem conteúdo:\n` +
      `  • Story: ${d.story?.topic?.slice(0, 50) || 'N/A'}\n` +
      `  • Carrossel: ${d.carousel?.topic?.slice(0, 50) || 'N/A'}\n` +
      `  • Kling: ${d.reel_kling?.topic?.slice(0, 50) || 'N/A'}`
    );
  } else {
    alertas.push(`🔴 HOJE (${hoje}) sem conteúdo no cronograma!`);
    relatorio.push(`❌ Hoje sem conteúdo no cronograma`);
  }

  // ── Recipe tracker ───────────────────────────────────────────────────────
  try {
    if (fs.existsSync(RECIPES_FILE)) {
      const tracker = JSON.parse(fs.readFileSync(RECIPES_FILE, 'utf8'));
      const total    = tracker.recipes?.length || 0;
      const pointer  = tracker.currentIndex || 0;
      const restantes = total - pointer;
      if (restantes < 7) {
        alertas.push(`🟡 Receitas esgotando: ${restantes} restantes de ${total}`);
      }
      relatorio.push(`✅ Receitas: ${restantes} disponíveis (pointer ${pointer}/${total})`);
    } else {
      relatorio.push(`ℹ️ recipe-tracker.json não encontrado`);
    }
  } catch {
    relatorio.push(`⚠️ Erro ao ler recipe-tracker.json`);
  }

  // ── Kling pool ───────────────────────────────────────────────────────────
  try {
    if (fs.existsSync(KLING_POOL_DIR)) {
      const videos = fs.readdirSync(KLING_POOL_DIR).filter(f => f.endsWith('.mp4'));
      if (videos.length < 3) {
        alertas.push(`🟡 Kling pool baixo: ${videos.length} vídeo(s) disponíveis`);
      }
      relatorio.push(`✅ Kling pool: ${videos.length} vídeo(s) disponíveis`);
    }
  } catch {
    relatorio.push(`ℹ️ kling-pool não acessível neste ambiente`);
  }

  // ── Monta mensagem ───────────────────────────────────────────────────────
  const icone = alertas.length === 0 ? '🟢' : alertas.some(a => a.startsWith('🔴')) ? '🔴' : '🟡';

  const msg =
    `📋 <b>Fiscal de Cronograma — ${data}</b>\n` +
    `${icone} Saúde do conteúdo\n\n` +
    relatorio.join('\n') +
    (alertas.length > 0
      ? '\n\n⚠️ <b>Alertas:</b>\n' + alertas.join('\n')
      : '\n\n✅ Cronograma e conteúdo em dia!');

  console.log(msg.replace(/<[^>]+>/g, ''));
  await enviarTelegram(msg);
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-cronograma:', err.message);
  process.exit(1);
});
