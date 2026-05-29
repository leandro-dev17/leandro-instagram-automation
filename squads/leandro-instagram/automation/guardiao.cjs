#!/usr/bin/env node
'use strict';

/**
 * guardiao.cjs — Guardião Central da Automação @leandro_personall
 *
 * Adaptado do sistema Guardian da Vovó Teresinha para GitHub Actions.
 * Roda a cada 15 minutos via cron do GitHub Actions.
 *
 * HIERARQUIA DE ESCALONAMENTO (igual à Vovó Teresinha):
 *   1ª-2ª falha → retry silencioso via workflow_dispatch
 *   3ª falha    → alerta Telegram + retry
 *   4ª+ falha   → aciona Claude Resolver (último recurso)
 *
 * Estado de falhas: arquivo JSON no repositório (logs/guardian-state.json)
 * commitado pelo próprio guardião após cada atualização.
 */

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

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
const LOGS_DIR     = path.join(__dirname, 'logs');
const STATE_FILE   = path.join(LOGS_DIR, 'guardian-state.json');
const STATE_REPO   = 'squads/leandro-instagram/automation/logs/guardian-state.json';

// Limites de escalação (copiado da hierarquia Vovó Teresinha)
const LIMITE_ALERTA_TELEGRAM = 3; // 3ª falha → alerta + retry
const LIMITE_CLAUDE_RESOLVER = 4; // 4ª+ falha → Claude

// Jobs monitorados com suas janelas de tempo esperadas (UTC)
const JOBS_MONITORADOS = [
  { id: 'daily-generator', label: '📊 Gerador',    horaInicioUTC: 7,  horaFimUTC: 10, janelaBRT: '05h-07h' },
  { id: 'story-07h',       label: '📸 Story',      horaInicioUTC: 9,  horaFimUTC: 13, janelaBRT: '07h-10h' },
  { id: 'kling-reel-20h',  label: '🎬 Kling',      horaInicioUTC: 14, horaFimUTC: 17, janelaBRT: '12h-14h' },
  { id: 'carousel-12h',    label: '📋 Carrossel',  horaInicioUTC: 17, horaFimUTC: 20, janelaBRT: '15h-17h' },
  { id: 'reel-dica-1730h', label: '🍳 Reel',       horaInicioUTC: 20, horaFimUTC: 23, janelaBRT: '17h-20h' },
];

// ── Utilitários ───────────────────────────────────────────────────────────────

async function githubApi(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Guardiao/1.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, opts);
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: res.ok, status: res.status };
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function dispararJob(jobId) {
  const res = await githubApi(
    `/actions/workflows/${WORKFLOW_ID}/dispatches`,
    'POST',
    { ref: 'main', inputs: { job: jobId } }
  );
  return res.ok !== false;
}

async function invocarClaudeResolver(jobId, falhasCount, erro) {
  const script = path.join(__dirname, 'claude-resolver.cjs');
  if (!fs.existsSync(script)) {
    console.warn('claude-resolver.cjs não encontrado — apenas alerta Telegram');
    await enviarTelegram(
      `🚨 <b>GUARDIÃO — Limite atingido: ${jobId}</b>\n\n` +
      `Falhas: ${falhasCount}x\n` +
      `Claude Resolver não encontrado.\n\n` +
      `⚠️ <b>Leandro, intervenção manual necessária!</b>\n` +
      `Acesse: github.com/${REPO}/actions`
    );
    return;
  }

  console.log(`[guardiao] Acionando Claude Resolver para ${jobId} (${falhasCount}x falhas)...`);
  try {
    execSync(
      `node "${script}" "${jobId}" ${falhasCount} "${(erro || '').replace(/"/g, "'")}"`,
      { stdio: 'inherit', timeout: 5 * 60 * 1000 } // 5 min timeout
    );
  } catch (err) {
    console.error('Claude Resolver falhou:', err.message);
  }
}

// ── Estado de falhas (persistido no GitHub) ───────────────────────────────────

async function carregarEstado() {
  // Tenta ler do repositório via GitHub API
  try {
    const data = await githubApi(`/contents/${STATE_REPO}`);
    if (data.content) {
      const conteudo = Buffer.from(data.content, 'base64').toString('utf8');
      return { ...JSON.parse(conteudo), sha: data.sha };
    }
  } catch { /* arquivo não existe ainda */ }

  // Fallback: lê arquivo local
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
    }
  } catch { /* ignora */ }

  return { falhas: {}, ultimaVerificacao: null, sha: null };
}

async function salvarEstado(estado) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const { sha, ...estadoSemSha } = estado;
  estadoSemSha.ultimaVerificacao = new Date().toISOString();

  // Salva local
  fs.writeFileSync(STATE_FILE, JSON.stringify(estadoSemSha, null, 2));

  // Commit no GitHub (assíncrono — não bloqueia se falhar)
  try {
    const content = Buffer.from(JSON.stringify(estadoSemSha, null, 2)).toString('base64');
    const body = {
      message: `chore: guardian-state ${new Date().toISOString().slice(0, 16)}`,
      content,
      committer: { name: 'BioNexus Guardião', email: 'bot@bionexus.local' },
    };
    if (sha) body.sha = sha;
    await githubApi(`/contents/${STATE_REPO}`, 'PUT', body);
  } catch { /* silencioso — o estado local ainda funciona */ }
}

// ── Verifica jobs com falha nas últimas 2h ────────────────────────────────────

async function getJobsFalhando() {
  const desde = new Date(Date.now() - 2 * 3600000).toISOString().slice(0, 10);
  const data  = await githubApi(`/actions/runs?created>=${desde}&per_page=100`);
  const runs  = (data.workflow_runs || []).filter(r =>
    (r.path?.includes('bionexus-daily') || r.name?.includes('Diárias')) &&
    new Date(r.created_at) >= new Date(Date.now() - 2 * 3600000)
  );

  const statusPorJob = {};

  for (const run of runs) {
    let jobsData;
    try { jobsData = await githubApi(`/actions/runs/${run.id}/jobs`); } catch { continue; }
    for (const job of (jobsData.jobs || [])) {
      const monitorado = JOBS_MONITORADOS.find(j => j.id === job.name);
      if (!monitorado) continue;
      if (!statusPorJob[job.name]) {
        statusPorJob[job.name] = { conclusion: job.conclusion, runId: run.id };
      }
    }
  }

  // Identifica falhas nos jobs que deveriam ter rodado até agora
  const agora     = new Date();
  const horaUTC   = agora.getUTCHours();
  const falhando  = [];

  for (const j of JOBS_MONITORADOS) {
    // Só verifica se a janela desse job já passou
    if (horaUTC < j.horaFimUTC) continue;
    const s = statusPorJob[j.id];
    if (!s || s.conclusion === 'failure' || (horaUTC > j.horaFimUTC + 1 && !s)) {
      falhando.push({ ...j, runId: s?.runId, conclusion: s?.conclusion || 'not_run' });
    }
  }

  return falhando;
}

// ── Auditoria completa a cada 15 min ─────────────────────────────────────────

async function auditoriaCompleta() {
  const hora  = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
  const today = new Date().toISOString().slice(0, 10);
  console.log(`[guardiao] Auditoria — ${hora} BRT`);

  const estado = await carregarEstado();
  if (!estado.falhas) estado.falhas = {};

  // Limpa falhas de dias anteriores
  for (const jobId of Object.keys(estado.falhas)) {
    if (estado.falhas[jobId]?.data !== today) {
      delete estado.falhas[jobId];
    }
  }

  // Verifica jobs falhando agora
  let jobsFalhando = [];
  try {
    jobsFalhando = await getJobsFalhando();
  } catch (err) {
    console.warn('[guardiao] Não conseguiu verificar runs:', err.message);
    return; // Se a API do GitHub está fora, não age
  }

  if (jobsFalhando.length === 0) {
    console.log('[guardiao] ✅ Tudo OK — nenhuma falha detectada.');
    // Zera contadores de jobs que estão OK agora
    for (const j of JOBS_MONITORADOS) {
      if (estado.falhas[j.id]) delete estado.falhas[j.id];
    }
    await salvarEstado(estado);
    return;
  }

  // Processa cada falha
  for (const job of jobsFalhando) {
    if (!estado.falhas[job.id]) {
      estado.falhas[job.id] = { data: today, count: 0, ultimaFalha: null };
    }
    estado.falhas[job.id].count++;
    estado.falhas[job.id].ultimaFalha = new Date().toISOString();
    estado.falhas[job.id].data = today;

    const count = estado.falhas[job.id].count;
    console.log(`[guardiao] ${job.label} — falha #${count}`);

    if (count < LIMITE_ALERTA_TELEGRAM) {
      // 1ª-2ª falha: retry silencioso
      console.log(`[guardiao] Retry silencioso para ${job.id}...`);
      await dispararJob(job.id);

    } else if (count === LIMITE_ALERTA_TELEGRAM) {
      // 3ª falha: alerta + retry
      await enviarTelegram(
        `🟡 <b>Guardião — Atenção: ${job.label}</b>\n\n` +
        `Falha #${count} detectada (BRT ${job.janelaBRT})\n` +
        `Status: ${job.conclusion}\n\n` +
        `🔄 Retry automático sendo acionado...`
      );
      await dispararJob(job.id);

    } else if (count >= LIMITE_CLAUDE_RESOLVER) {
      // 4ª+ falha: Claude Resolver
      await invocarClaudeResolver(job.id, count, job.conclusion);
    }
  }

  await salvarEstado(estado);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  await auditoriaCompleta();
}

main().catch(err => {
  console.error('ERRO FATAL guardiao:', err.message);
  process.exit(1);
});
