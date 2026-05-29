#!/usr/bin/env node
'use strict';

/**
 * fiscal-horarios.cjs — Fiscal de Horários Intermediário
 *
 * Roda às 13:00 BRT (10:00 UTC) — detecta falhas de story e kling
 * 6 horas antes do fiscal-publicacoes, evitando perder o dia inteiro.
 *
 * Se detectar falha → tenta recuperação imediata via workflow_dispatch.
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

const REPO         = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const BOT_TOKEN    = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID      = process.env.TELEGRAM_CHAT_ID;
const WORKFLOW_ID  = 'bionexus-daily.yml';

// Apenas os jobs da manhã — story e kling (já deveriam ter rodado até 13h BRT)
const JOBS_MANHA = [
  { id: 'daily-generator', label: '📊 Gerador',   horaUTC: 8  },
  { id: 'story-07h',       label: '📸 Story',     horaUTC: 10 },
  { id: 'kling-reel-20h',  label: '🎬 Kling',     horaUTC: 15 },
];

async function githubApi(endpoint) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-FiscalHorarios/1.0',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${endpoint}: ${res.status}`);
  return res.json();
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function dispararRecuperacao(jobId) {
  if (!GITHUB_TOKEN) return false;
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/workflows/${WORKFLOW_ID}/dispatches`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref: 'main', inputs: { job: jobId } }),
    }
  );
  return res.ok;
}

async function main() {
  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  console.log(`[fiscal-horarios] Verificação intermediária — ${hora} BRT`);

  const hoje = new Date().toISOString().slice(0, 10);
  const data = await githubApi(`/actions/runs?created>=${hoje}&per_page=100`);
  const runs = (data.workflow_runs || []).filter(r =>
    r.path?.includes('bionexus-daily') || r.name?.includes('Diárias')
  );

  // Mapeia status de cada job da manhã
  const status = {};
  for (const j of JOBS_MANHA) status[j.id] = 'not_run';

  for (const run of runs) {
    let jobsData;
    try { jobsData = await githubApi(`/actions/runs/${run.id}/jobs`); } catch { continue; }
    for (const job of (jobsData.jobs || [])) {
      if (status[job.name] === 'not_run') {
        status[job.name] = job.conclusion || job.status || 'unknown';
      }
    }
  }

  const horaAtualUTC = new Date().getUTCHours();
  const falhas = [];
  const linhas = [];

  for (const j of JOBS_MANHA) {
    // Só verifica jobs que deveriam ter rodado até agora
    if (j.horaUTC > horaAtualUTC) {
      linhas.push(`⏰ ${j.label} — ainda não era o horário`);
      continue;
    }
    const s = status[j.id];
    const icon = s === 'success' ? '✅' : s === 'failure' ? '❌' : s === 'not_run' ? '⏭️' : '❓';
    linhas.push(`${icon} ${j.label}`);
    if (s === 'failure') falhas.push(j);
  }

  if (falhas.length === 0) {
    console.log('✅ Publicações da manhã OK.');
    // Sem alertas se tudo estiver bem — evita spam no Telegram
    return;
  }

  // Alerta + recuperação imediata
  const linhasRecuperacao = [];
  for (const j of falhas) {
    console.log(`⚠️ Falha detectada: ${j.label} — disparando recuperação...`);
    const ok = await dispararRecuperacao(j.id);
    linhasRecuperacao.push(ok
      ? `🔄 ${j.label} — recuperação iniciada`
      : `🆘 ${j.label} — falha na recuperação`
    );
    await new Promise(r => setTimeout(r, 3000));
  }

  await enviarTelegram(
    `🟡 <b>Fiscal de Horários — ${hora} BRT</b>\n\n` +
    linhas.join('\n') + '\n\n' +
    `⚠️ <b>${falhas.length} falha(s) na manhã — recuperação iniciada:</b>\n` +
    linhasRecuperacao.join('\n')
  );
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-horarios:', err.message);
  process.exit(1);
});
