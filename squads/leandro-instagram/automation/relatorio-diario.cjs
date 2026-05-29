#!/usr/bin/env node
'use strict';

/**
 * relatorio-diario.cjs — Agente Relatório Diário (@leandro_personall)
 *
 * Adaptado do ceo-relatorio da Vovó Teresinha para o contexto
 * de automação de Instagram sem banco de dados.
 *
 * Executa às 23:45 UTC (20:45 BRT) via GitHub Actions.
 * Resume o dia: o que publicou, o que falhou, o que vem amanhã.
 */

const fs   = require('fs');
const path = require('path');

// ── Carrega .env ─────────────────────────────────────────────────────────────
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

const REPO          = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
const SCHEDULE_DIR  = path.join(__dirname, 'schedule');
const WORKFLOW_FILE = 'bionexus-daily.yml';

// Jobs diários esperados com seus labels e cron labels
const JOBS_ESPERADOS = [
  { id: 'daily-generator', label: '📊 Gerador Diário',  hora: '05:00' },
  { id: 'story-07h',       label: '📸 Story',           hora: '07:00' },
  { id: 'kling-reel-20h',  label: '🎬 Reel Kling',      hora: '11:59' },
  { id: 'carousel-12h',    label: '📋 Carrossel',       hora: '15:00' },
  { id: 'reel-dica-1730h', label: '🍳 Reel Receita',    hora: '17:30' },
];

// ── Helpers ──────────────────────────────────────────────────────────────────

async function githubApi(endpoint) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Guardian/1.0',
    },
  });
  if (!res.ok) throw new Error(`GitHub API ${endpoint}: ${res.status}`);
  return res.json();
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log('[Telegram desabilitado]'); return; }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
  if (!res.ok) console.warn('Telegram falhou:', await res.text());
}

// Retorna o status de cada job esperado nas runs de hoje
async function getJobStatusHoje() {
  const hoje = new Date().toISOString().slice(0, 10);
  const data = await githubApi(
    `/actions/runs?created>=${hoje}&per_page=100&status=completed`
  );
  const runs = (data.workflow_runs || []).filter(r =>
    r.path?.includes(WORKFLOW_FILE) || r.name?.includes('Publicações')
  );

  // Indexa resultado de cada job (só o mais recente por nome)
  const status = {};
  for (const expected of JOBS_ESPERADOS) {
    status[expected.id] = { conclusion: 'not_run', runId: null };
  }

  for (const run of runs) {
    let jobsData;
    try { jobsData = await githubApi(`/actions/runs/${run.id}/jobs`); } catch { continue; }
    for (const job of (jobsData.jobs || [])) {
      if (status[job.name] && status[job.name].conclusion === 'not_run') {
        status[job.name] = { conclusion: job.conclusion, runId: run.id };
      }
    }
  }

  return status;
}

// Lê o schedule do dia seguinte para mostrar o que vem amanhã
function getScheduleAmanha() {
  const amanha = new Date();
  amanha.setDate(amanha.getDate() + 1);
  const amanhaStr = amanha.toISOString().slice(0, 10);

  if (!fs.existsSync(SCHEDULE_DIR)) return null;
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json')).sort().reverse();
  for (const file of files) {
    try {
      const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
      if (plan.days?.[amanhaStr]) return { date: amanhaStr, day: plan.days[amanhaStr] };
    } catch { continue; }
  }
  return null;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const hoje    = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const horaFim = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  console.log(`[relatorio-diario] Gerando relatório — ${hoje} ${horaFim}`);

  // Coleta status dos jobs
  let jobStatus = {};
  let erroApi = '';
  try {
    jobStatus = await getJobStatusHoje();
  } catch (err) {
    erroApi = err.message;
    for (const j of JOBS_ESPERADOS) {
      jobStatus[j.id] = { conclusion: 'unknown' };
    }
  }

  // Monta linhas de status
  let totalOk = 0;
  let totalFalha = 0;
  const linhasStatus = JOBS_ESPERADOS.map(j => {
    const s = jobStatus[j.id]?.conclusion;
    let icon;
    if (s === 'success')  { icon = '✅'; totalOk++;    }
    else if (s === 'failure') { icon = '❌'; totalFalha++; }
    else if (s === 'not_run') { icon = '⏭️'; }
    else                      { icon = '❓'; }
    return `${icon} ${j.label} (BRT ${j.hora})`;
  });

  // Amanhã
  const amanha = getScheduleAmanha();
  let linhasAmanha = '';
  if (amanha) {
    const d = amanha.day;
    linhasAmanha =
      `\n📅 <b>Amanhã — ${amanha.date}</b>\n` +
      (d.story?.topic      ? `• Story: ${d.story.topic}\n` : '') +
      (d.carousel?.topic   ? `• Carrossel: ${d.carousel.topic}\n` : '') +
      (d.reel_kling?.topic ? `• Kling: ${d.reel_kling.topic}\n` : '') +
      `• Receita: gerada pelo daily-generator\n`;
  } else {
    linhasAmanha = '\n⚠️ <b>Amanhã sem cronograma</b> — execute o weekly-planner.\n';
  }

  // Saúde geral
  const saudeIcon = totalFalha === 0 ? '🟢' : totalFalha <= 1 ? '🟡' : '🔴';

  const msg =
    `👑 <b>Relatório Diário — @leandro_personall</b>\n` +
    `${saudeIcon} ${hoje} | ${horaFim}\n\n` +
    `📊 <b>Publicações do dia:</b>\n` +
    linhasStatus.join('\n') + '\n' +
    (totalFalha > 0
      ? `\n⚠️ ${totalFalha} falha(s) detectada(s).\nRodou recuperação automática? Verifique o fiscal-publicacoes.\n`
      : `\n✅ Dia perfeito — todas as publicações concluídas!\n`) +
    linhasAmanha +
    (erroApi ? `\n⚙️ Aviso: GitHub API com instabilidade (${erroApi.slice(0, 60)})\n` : '') +
    `\n<i>Próximo relatório: amanhã às 20:45 BRT</i>`;

  console.log(msg.replace(/<[^>]+>/g, ''));
  await enviarTelegram(msg);
}

main().catch(err => {
  console.error('ERRO FATAL relatorio-diario:', err.message);
  process.exit(1);
});
