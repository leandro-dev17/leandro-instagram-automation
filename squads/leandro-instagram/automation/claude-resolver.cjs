#!/usr/bin/env node
'use strict';

/**
 * claude-resolver.cjs — Claude como Agente Autônomo da Automação BioNexus Digital
 *
 * Acionado pelo guardiao.cjs para resolver QUALQUER problema da operação.
 * Claude recebe contexto completo e ferramentas para agir autonomamente:
 *
 * APIs disponíveis:
 * - Instagram Graph API (testar token, renovar, listar posts, publicar)
 * - GitHub API (ler logs, modificar código, disparar jobs, atualizar secrets)
 * - Telegram (enviar mensagens)
 * - Schedule (ler e atualizar cronograma)
 * - Receitas (gerar novas receitas com Claude)
 * - Pool Kling (verificar disponibilidade de vídeos)
 * - Claude API (gerar conteúdo, analisar situações)
 *
 * Uso: node claude-resolver.cjs <tipo> <descricao> [dados_json]
 *   tipo: falha_job | token_expirando | schedule_vazio | pool_kling_baixo | erro_generico
 */

const fs            = require('fs');
const path          = require('path');
const { spawnSync } = require('child_process');

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

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const IG_TOKEN       = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID     = process.env.INSTAGRAM_USER_ID;
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const REPO           = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const WORKFLOW_ID    = 'bionexus-daily.yml';
const WEEKLY_WF_ID   = 'bionexus-weekly.yml';
const SCHEDULE_DIR   = path.join(__dirname, 'schedule');
const RECIPES_DIR    = path.join(__dirname, 'recipes');
const POOL_DIR       = path.join(__dirname, 'kling-pool');
const TRACKING_FILE  = path.join(__dirname, 'logs', 'published-posts.json');

// ── Fix defensivo (Claude Resolver) ───────────────────────────────────────────
// Antes este bloco fazia process.exit(1) quando a ANTHROPIC_API_KEY faltava.
// Como o guardião invoca este script com execSync({ stdio: 'inherit' }), o exit 1
// PROPAGAVA e derrubava o PRÓPRIO GUARDIÃO em cascata — interrompendo o
// monitoramento de TODAS as publicações sempre que a key da Anthropic ficava
// indisponível (expirada/sem créditos). Agora notificamos o Leandro via Telegram
// e saímos com exit 0, mantendo o guardião e as publicações em pé.
if (!ANTHROPIC_KEY) {
  console.error('ERRO: ANTHROPIC_API_KEY ausente — Claude Resolver não pode operar autonomamente.');
  (async () => {
    if (BOT_TOKEN && CHAT_ID) {
      try {
        await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: CHAT_ID,
            parse_mode: 'HTML',
            text:
              '🚨 <b>ANTHROPIC_API_KEY indisponível</b>\n\n' +
              'O Claude Resolver foi acionado mas não há chave da Anthropic válida.\n\n' +
              '⚠️ Impacto: hooks dos reels caem em <i>fallback</i>, fiscais de qualidade acusam ' +
              'problema e qualquer geração de texto via Claude para de funcionar.\n\n' +
              '👉 <b>Ação necessária:</b> renove/verifique a <code>ANTHROPIC_API_KEY</code> ' +
              '(créditos/validade) e atualize o secret no GitHub.\n' +
              `Repo: github.com/${REPO}/settings/secrets/actions`,
          }),
        });
      } catch { /* silencioso */ }
    }
    // exit 0 de propósito: NÃO derrubar o guardião que nos invocou.
    process.exit(0);
  })();
  return;
}

// ── Helpers HTTP ──────────────────────────────────────────────────────────────

async function githubApi(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Claude-Resolver/2.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, opts);
  const text = await res.text();
  return text ? JSON.parse(text) : { ok: res.ok, status: res.status };
}

async function igApi(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const res = await fetch(
    `https://graph.instagram.com/v21.0${endpoint}${sep}access_token=${IG_TOKEN}`,
    { signal: AbortSignal.timeout(20000) }
  );
  const data = await res.json();
  if (data.error) throw new Error(`IG API: ${data.error.message}`);
  return data;
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log('[Telegram]', msg.replace(/<[^>]+>/g, '')); return false; }
  const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
  return res.ok;
}

// === APIs INSTAGRAM ===

async function testarTokenInstagram() {
  if (!IG_TOKEN || !IG_USER_ID) return { ok: false, motivo: 'Token ou User ID não configurados' };
  try {
    const conta = await igApi(`/${IG_USER_ID}?fields=id,username,followers_count`);
    const expiracao = process.env.INSTAGRAM_TOKEN_EXPIRES_AT;
    const dias = expiracao
      ? Math.ceil((new Date(expiracao) - new Date()) / 86400000)
      : null;
    return { ok: true, username: conta.username, seguidores: conta.followers_count, diasAteExpirar: dias, expiracao };
  } catch (err) { return { ok: false, motivo: err.message }; }
}

async function renovarTokenInstagram() {
  try {
    const res = await fetch(
      `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${IG_TOKEN}`,
      { signal: AbortSignal.timeout(15000) }
    );
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    const novoToken     = data.access_token;
    const novaExpiracao = new Date(Date.now() + 60 * 86400000).toISOString().slice(0, 10);
    // Atualiza secrets no GitHub via gh CLI
    const r1 = await atualizarSecretGitHub('INSTAGRAM_ACCESS_TOKEN', novoToken);
    const r2 = await atualizarSecretGitHub('INSTAGRAM_TOKEN_EXPIRES_AT', novaExpiracao);
    return { ok: true, novaExpiracao, secretsAtualizados: r1.ok && r2.ok };
  } catch (err) { return { ok: false, erro: err.message }; }
}

async function atualizarSecretGitHub(nome, valor) {
  const ghToken = process.env.GH_TOKEN || GITHUB_TOKEN;
  const env     = { ...process.env, GH_TOKEN: ghToken };
  const result  = spawnSync('gh', ['secret', 'set', nome, '--repo', REPO, '--body', valor], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env,
  });
  return { ok: result.status === 0, nome, stderr: result.stderr?.trim() };
}

async function lerLogRun(runId) {
  const jobsData = await githubApi(`/actions/runs/${runId}/jobs`);
  return (jobsData.jobs || []).map(j => ({
    nome: j.name, status: j.status, conclusion: j.conclusion,
    steps: (j.steps || []).filter(s => s.conclusion === 'failure').map(s => ({ nome: s.name, conclusao: s.conclusion })),
    logUrl: `https://github.com/${REPO}/actions/runs/${runId}`,
  }));
}

async function lerArquivo(filePath) {
  try {
    const data = await githubApi(`/contents/${filePath}`);
    if (data.content) {
      const conteudo = Buffer.from(data.content, 'base64').toString('utf8');
      return { filePath, conteudo: conteudo.slice(0, 10000), tamanho: conteudo.length, sha: data.sha };
    }
    return { filePath, erro: 'Arquivo não encontrado ou binário' };
  } catch (err) { return { filePath, erro: err.message }; }
}

async function atualizarArquivo(filePath, novoConteudo, mensagemCommit) {
  let sha;
  try {
    const atual = await githubApi(`/contents/${filePath}`);
    sha = atual.sha;
  } catch { /* novo arquivo */ }

  const content = Buffer.from(novoConteudo).toString('base64');
  const body    = {
    message: `fix(auto): ${mensagemCommit} — Claude Resolver ${new Date().toISOString().slice(0, 16)}`,
    content,
    committer: { name: 'BioNexus Claude Resolver', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  try {
    const result = await githubApi(`/contents/${filePath}`, 'PUT', body);
    return { ok: !!result.content?.sha, filePath, mensagemCommit };
  } catch (err) { return { ok: false, filePath, erro: err.message }; }
}

async function dispararJob(workflowId, jobId, motivo) {
  const wf = workflowId || WORKFLOW_ID;
  const res = await fetch(`https://api.github.com/repos/${REPO}/actions/workflows/${wf}/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { job: jobId } }),
  });
  return { ok: res.ok, workflowId: wf, jobId, motivo };
}

async function verificarRunsRecentes(horas = 6) {
  const desde = new Date(Date.now() - horas * 3600000).toISOString().slice(0, 10);
  const data  = await githubApi(`/actions/runs?created>=${desde}&per_page=50`);
  return (data.workflow_runs || [])
    .filter(r => new Date(r.created_at) >= new Date(Date.now() - horas * 3600000))
    .map(r => ({ id: r.id, status: r.status, conclusion: r.conclusion, criadoEm: r.created_at, workflow: r.path }));
}

async function listarPostsInstagram(quantidade = 10) {
  try {
    const res = await igApi(`/${IG_USER_ID}/media?fields=id,media_type,timestamp,like_count,comments_count,caption&limit=${quantidade}`);
    return (res.data || []).map(p => ({
      id: p.id, tipo: p.media_type, data: p.timestamp?.slice(0, 10),
      likes: p.like_count, comentarios: p.comments_count,
      captionPreview: (p.caption || '').slice(0, 100),
    }));
  } catch (err) { return { erro: err.message }; }
}

async function obterInsightsInstagram(periodo = 'week') {
  try {
    const res = await igApi(`/${IG_USER_ID}/insights?metric=reach,impressions,profile_views&period=${periodo}`);
    const insights = {};
    for (const m of (res.data || [])) {
      insights[m.name] = m.values?.[m.values.length - 1]?.value || m.value || 0;
    }
    return insights;
  } catch (err) { return { erro: err.message }; }
}

// === SCHEDULE E CONTEÚDO ===

function lerScheduleLocal() {
  if (!fs.existsSync(SCHEDULE_DIR)) return { erro: 'Pasta schedule não encontrada' };
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json') && f.startsWith('week-')).sort().reverse();
  const schedule = {};
  for (const f of files.slice(0, 3)) {
    const data = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, f), 'utf8'));
    Object.assign(schedule, data.days || {});
  }
  const hoje = new Date().toISOString().slice(0, 10);
  const proximos8 = [];
  for (let i = 0; i < 8; i++) {
    const d = new Date(); d.setDate(d.getDate() + i);
    const ds = d.toISOString().slice(0, 10);
    proximos8.push({ data: ds, temCobertura: !!schedule[ds], conteudo: schedule[ds] ? { story: schedule[ds].story?.topic, carousel: schedule[ds].carousel?.topic, kling: schedule[ds].reel_kling?.topic } : null });
  }
  return { proximos8 };
}

module.exports = {
  testarTokenInstagram, renovarTokenInstagram, atualizarSecretGitHub,
  lerLogRun, lerArquivo, atualizarArquivo, dispararJob, verificarRunsRecentes,
  listarPostsInstagram, obterInsightsInstagram, lerScheduleLocal, enviarTelegram,
};
