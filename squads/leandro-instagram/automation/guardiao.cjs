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

async function invocarClaudeResolver(tipo, descricao, dados, count = 4) {
  const script = path.join(__dirname, 'claude-resolver.cjs');
  if (!fs.existsSync(script)) {
    console.warn('claude-resolver.cjs não encontrado — apenas alerta Telegram');
    await enviarTelegram(
      `🚨 <b>GUARDIÃO — ${tipo}</b>\n\n${descricao}\n\n` +
      `⚠️ <b>Leandro, intervenção manual necessária!</b>\n` +
      `Acesse: github.com/${REPO}/actions`
    );
    return;
  }

  console.log(`[guardiao] Acionando Claude Resolver — ${tipo}: ${descricao.slice(0, 80)}`);
  try {
    const dadosStr = dados ? JSON.stringify(dados).replace(/"/g, '\\"') : '';
    execSync(
      `node "${script}" "${tipo}" "${descricao.replace(/"/g, "'")}" "${dadosStr}"`,
      { stdio: 'inherit', timeout: 8 * 60 * 1000 } // 8 min timeout
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
      // Só registra execuções reais — ignora 'skipped'
      if (!statusPorJob[job.name] && job.conclusion !== 'skipped' && job.conclusion !== null) {
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

// ── Verificações proativas (não apenas falhas de jobs) ───────────────────────

async function verificarSituacoesProativas(estado, today) {
  const alertas = [];

  // 1. Token Instagram expirando?
  const igExpiracao = process.env.INSTAGRAM_TOKEN_EXPIRES_AT;
  if (igExpiracao) {
    const diasRestantes = Math.ceil((new Date(igExpiracao) - new Date()) / 86400000);
    if (diasRestantes <= 0) {
      alertas.push({ tipo: 'token_expirado', descricao: `Token Instagram EXPIRADO em ${igExpiracao}!`, urgente: true });
    } else if (diasRestantes <= 7) {
      const chaveEstado = 'token_alerta';
      if (!estado[chaveEstado] || estado[chaveEstado] !== today) {
        estado[chaveEstado] = today;
        alertas.push({ tipo: 'token_expirando', descricao: `Token Instagram expira em ${diasRestantes} dias (${igExpiracao})`, urgente: false });
      }
    }
  }

  // 2. Schedule tem cobertura suficiente?
  const SCHEDULE_DIR = path.join(__dirname, 'schedule');
  if (fs.existsSync(SCHEDULE_DIR)) {
    const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json') && f.startsWith('week-')).sort().reverse();
    const schedule = {};
    files.slice(0, 3).forEach(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, f), 'utf8'));
        Object.assign(schedule, data.days || {});
      } catch { /* ignora */ }
    });

    // Verifica próximos 4 dias (janela crítica)
    const diasSemCobertura = [];
    for (let i = 1; i <= 4; i++) {
      const d = new Date(); d.setDate(d.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      if (!schedule[ds]) diasSemCobertura.push(ds);
    }

    if (diasSemCobertura.length >= 2) {
      const chaveEstado = `schedule_alerta_${diasSemCobertura[0]}`;
      if (!estado[chaveEstado]) {
        estado[chaveEstado] = today;
        alertas.push({
          tipo: 'schedule_vazio',
          descricao: `${diasSemCobertura.length} dias sem cobertura nos próximos 4: ${diasSemCobertura.join(', ')}`,
          urgente: diasSemCobertura.length >= 3,
        });
      }
    }
  }

  // 3. Pool Kling crítico?
  const POOL_DIR = path.join(__dirname, 'kling-pool');
  if (fs.existsSync(POOL_DIR)) {
    const videos  = fs.readdirSync(POOL_DIR).filter(f => f.endsWith('.mp4'));
    const corte   = new Date(Date.now() - 14 * 86400000);
    const usados  = new Set();
    const trackFile = path.join(__dirname, 'logs', 'published-posts.json');
    if (fs.existsSync(trackFile)) {
      try {
        const tracking = JSON.parse(fs.readFileSync(trackFile, 'utf8'));
        for (const [ds, posts] of Object.entries(tracking)) {
          if (new Date(ds) >= corte) { const v = posts['kling-reel']?.videoId; if (v) usados.add(v); }
        }
      } catch { /* ignora */ }
    }
    const frescos = videos.filter(v => !usados.has(v.replace('.mp4', '')));
    if (frescos.length < 3) {
      const chaveEstado = 'pool_kling_alerta';
      if (!estado[chaveEstado] || estado[chaveEstado] !== today) {
        estado[chaveEstado] = today;
        alertas.push({ tipo: 'pool_kling_baixo', descricao: `Pool Kling crítico: apenas ${frescos.length} vídeo(s) fresco(s) de ${videos.length} total`, urgente: true });
      }
    }
  }

  // 4. Estoque de receitas baixo?
  const recipeTracker = path.join(__dirname, 'recipes', 'recipe-tracker.json');
  if (fs.existsSync(recipeTracker)) {
    try {
      const tracker = JSON.parse(fs.readFileSync(recipeTracker, 'utf8'));
      const usedSet = new Set(tracker.used || []);
      let total = 0;
      const recipesDir = path.join(__dirname, 'recipes');
      fs.readdirSync(recipesDir).filter(f => f.startsWith('batch') && f.endsWith('.json')).forEach(f => {
        total += JSON.parse(fs.readFileSync(path.join(recipesDir, f), 'utf8')).length;
      });
      const disponiveis = total - usedSet.size;
      if (disponiveis < 10) {
        const chaveEstado = 'receitas_alerta';
        if (!estado[chaveEstado] || estado[chaveEstado] !== today) {
          estado[chaveEstado] = today;
          alertas.push({ tipo: 'receitas_baixas', descricao: `Apenas ${disponiveis} receitas disponíveis de ${total}`, urgente: disponiveis < 5 });
        }
      }
    } catch { /* ignora */ }
  }

  return alertas;
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

  // ── VERIFICAÇÕES PROATIVAS ─────────────────────────────────────────────────
  // Token, schedule, pool kling, receitas — Claude resolve automaticamente
  const alertasProativos = await verificarSituacoesProativas(estado, today);

  for (const alerta of alertasProativos) {
    console.log(`[guardiao] ⚠️ Situação proativa: ${alerta.tipo}`);
    await invocarClaudeResolver(alerta.tipo, alerta.descricao, null, alerta.urgente ? 4 : 3);
    await new Promise(r => setTimeout(r, 5000));
  }

  // ── VERIFICAÇÃO DE FALHAS DE PUBLICAÇÃO ───────────────────────────────────
  let jobsFalhando = [];
  try {
    jobsFalhando = await getJobsFalhando();
  } catch (err) {
    console.warn('[guardiao] Não conseguiu verificar runs:', err.message);
    await salvarEstado(estado);
    return;
  }

  if (jobsFalhando.length === 0 && alertasProativos.length === 0) {
    console.log('[guardiao] ✅ Tudo OK — nenhuma falha ou alerta detectado.');
    for (const j of JOBS_MONITORADOS) {
      if (estado.falhas[j.id]) delete estado.falhas[j.id];
    }
    await salvarEstado(estado);
    return;
  }

  // Processa falhas de publicação
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
      console.log(`[guardiao] Retry silencioso para ${job.id}...`);
      await dispararJob(job.id);

    } else if (count === LIMITE_ALERTA_TELEGRAM) {
      await enviarTelegram(
        `🟡 <b>Guardião — Atenção: ${job.label}</b>\n\n` +
        `Falha #${count} detectada (BRT ${job.janelaBRT})\n` +
        `Status: ${job.conclusion}\n\n` +
        `🔄 Retry automático + Claude monitorando...`
      );
      await dispararJob(job.id);

    } else if (count >= LIMITE_CLAUDE_RESOLVER) {
      // Claude resolve com acesso completo a todas as APIs
      await invocarClaudeResolver(
        'falha_job',
        `Job "${job.label}" falhou ${count}x consecutivas — Status: ${job.conclusion}`,
        { jobId: job.id, count, conclusion: job.conclusion }
      );
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
