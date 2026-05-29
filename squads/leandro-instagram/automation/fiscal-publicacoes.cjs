#!/usr/bin/env node
'use strict';

/**
 * fiscal-publicacoes.cjs — Agente Fiscal de Publicações (@leandro_personall)
 *
 * Adaptado do fiscal-diario + gerente-conteudo da Vovó Teresinha.
 * Roda às 22:00 UTC (19:00 BRT), após todas as publicações do dia.
 *
 * 1. Verifica quais jobs do dia falharam
 * 2. Tenta recuperação automática via workflow_dispatch
 * 3. Alerta Telegram com diagnóstico
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

// Jobs esperados em ordem cronológica (BRT)
// Apenas os de publicação — daily-generator é pré-requisito, não publicação
const JOBS_PUBLICACAO = [
  { id: 'story-07h',       label: '📸 Story',        horaLimite: 11 }, // falhou se não rodou até 11h BRT
  { id: 'kling-reel-20h',  label: '🎬 Reel Kling',   horaLimite: 15 },
  { id: 'carousel-12h',    label: '📋 Carrossel',    horaLimite: 18 },
  { id: 'reel-dica-1730h', label: '🍳 Reel Receita', horaLimite: 20 },
];

// ── GitHub API ────────────────────────────────────────────────────────────────

async function githubApi(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Fiscal/1.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, opts);
  if (method !== 'POST' && !res.ok) throw new Error(`GitHub API ${endpoint}: ${res.status}`);
  return method === 'POST' ? { ok: res.ok, status: res.status } : res.json();
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function dispararRecuperacao(jobId) {
  if (!GITHUB_TOKEN) return false;
  const result = await githubApi(
    `/actions/workflows/${WORKFLOW_ID}/dispatches`,
    'POST',
    { ref: 'main', inputs: { job: jobId } }
  );
  return result.ok;
}

// ── Verifica status dos jobs ──────────────────────────────────────────────────

async function getStatusJobs() {
  const hoje = new Date().toISOString().slice(0, 10);
  const data = await githubApi(`/actions/runs?created>=${hoje}&per_page=100`);
  const runs = (data.workflow_runs || []).filter(r =>
    r.path?.includes('bionexus-daily') || r.name?.includes('Diárias')
  );

  const status = {};
  for (const j of JOBS_PUBLICACAO) {
    status[j.id] = { conclusion: 'not_run', runId: null, startedAt: null };
  }

  for (const run of runs.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))) {
    let jobsData;
    try { jobsData = await githubApi(`/actions/runs/${run.id}/jobs`); } catch { continue; }
    for (const job of (jobsData.jobs || [])) {
      if (status[job.name] && status[job.name].conclusion === 'not_run') {
        status[job.name] = {
          conclusion: job.conclusion || job.status,
          runId: run.id,
          startedAt: job.started_at,
        };
      }
    }
  }

  return status;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const horaBRT = new Date().toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo',
  });
  const dataBRT = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

  console.log(`[fiscal-publicacoes] Verificando publicações — ${dataBRT} ${horaBRT}`);

  let jobStatus;
  try {
    jobStatus = await getStatusJobs();
  } catch (err) {
    await enviarTelegram(
      `🔴 <b>Fiscal de Publicações — ERRO</b>\n\n` +
      `Não consegui consultar o GitHub API:\n${err.message}\n\n` +
      `Verifique manualmente: github.com/${REPO}/actions`
    );
    process.exit(1);
  }

  const falhas = [];
  const linhas = [];

  for (const job of JOBS_PUBLICACAO) {
    const s = jobStatus[job.id];
    const c = s?.conclusion;
    let icon;
    if (c === 'success')       icon = '✅';
    else if (c === 'failure')  { icon = '❌'; falhas.push(job); }
    else if (c === 'not_run')  { icon = '⏭️'; }
    else if (c === 'in_progress' || c === 'queued') { icon = '⏳'; }
    else                       icon = '❓';
    linhas.push(`${icon} ${job.label}`);
  }

  if (falhas.length === 0) {
    await enviarTelegram(
      `🟢 <b>Fiscal de Publicações — ${dataBRT}</b>\n\n` +
      linhas.join('\n') + '\n\n' +
      `✅ Todas as publicações do dia concluídas!`
    );
    console.log('✅ Tudo OK — nenhuma falha detectada.');
    return;
  }

  // Há falhas — inicia recuperação
  const linhasRecuperacao = [];
  for (const job of falhas) {
    console.log(`⚠️ Falha detectada: ${job.label} — iniciando recuperação...`);
    const ok = await dispararRecuperacao(job.id);
    linhasRecuperacao.push(ok
      ? `🔄 ${job.label} — recuperação iniciada`
      : `🆘 ${job.label} — FALHA na recuperação (verifique manualmente)`
    );
    // Intervalo para não disparar tudo simultâneo
    await new Promise(r => setTimeout(r, 5000));
  }

  await enviarTelegram(
    `🟡 <b>Fiscal de Publicações — ${dataBRT}</b>\n\n` +
    linhas.join('\n') + '\n\n' +
    `⚠️ <b>${falhas.length} falha(s) detectada(s):</b>\n` +
    linhasRecuperacao.join('\n') + '\n\n' +
    `<i>fix(auto): fiscal-publicacoes acionou recuperação em ${horaBRT}</i>`
  );

  console.log(`Recuperação acionada para ${falhas.length} job(s).`);
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-publicacoes:', err.message);
  process.exit(1);
});
