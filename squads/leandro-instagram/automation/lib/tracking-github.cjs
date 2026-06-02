'use strict';

/**
 * tracking-github.cjs — Tracking de publicações persistido no GitHub
 *
 * Resolve o problema fundamental no GitHub Actions: cada job começa
 * com checkout limpo e não vê o published-posts.json de runs anteriores.
 *
 * Solução: ler/escrever o tracking diretamente via GitHub Contents API,
 * garantindo que qualquer job veja as publicações de todos os outros.
 */

const fs   = require('fs');
const path = require('path');

const TRACKING_REPO_PATH = 'squads/leandro-instagram/automation/logs/published-posts.json';

function getGitHubConfig() {
  const token = process.env.GITHUB_TOKEN;
  const repo  = process.env.GITHUB_REPOSITORY;
  return { token, repo, available: !!(token && repo) };
}

async function githubRequest(method, repo, token, filePath, body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Tracking/1.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    signal: AbortSignal.timeout(15000),
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res  = await fetch(`https://api.github.com/repos/${repo}/contents/${filePath}`, opts);
  const text = await res.text();
  return { ok: res.ok, status: res.status, data: text ? JSON.parse(text) : null };
}

/**
 * Lê o tracking atual do GitHub (fonte de verdade).
 * Faz merge com o arquivo local para garantir consistência.
 */
async function lerTrackingCompleto(localFile) {
  const { token, repo, available } = getGitHubConfig();

  // Lê arquivo local primeiro (pode ter entradas recentes ainda não commitadas)
  let local = {};
  if (localFile && fs.existsSync(localFile)) {
    try { local = JSON.parse(fs.readFileSync(localFile, 'utf8')); } catch { /* ignora */ }
  }

  if (!available) return local;

  // Lê do GitHub (fonte de verdade para runs anteriores)
  let github = {};
  let sha;
  try {
    const { ok, data } = await githubRequest('GET', repo, token, TRACKING_REPO_PATH);
    if (ok && data?.content) {
      github = JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
      sha    = data.sha;
    }
  } catch { /* usa só o local */ }

  // Merge: GitHub tem o histórico, local tem entradas recentes
  const merged = { ...github };
  for (const [date, posts] of Object.entries(local)) {
    if (!merged[date]) merged[date] = {};
    Object.assign(merged[date], posts);
  }

  // Salva o SHA para usar no commit
  if (localFile && sha) {
    try {
      const metaPath = localFile + '.sha';
      fs.writeFileSync(metaPath, sha);
    } catch { /* ignora */ }
  }

  return merged;
}

/**
 * Salva o tracking localmente E commita ao GitHub.
 */
async function salvarTracking(localFile, tracking) {
  // Salva local
  try {
    const dir = path.dirname(localFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(localFile, JSON.stringify(tracking, null, 2));
  } catch (err) {
    console.warn(`⚠️ Falha ao salvar tracking local: ${err.message}`);
  }

  const { token, repo, available } = getGitHubConfig();
  if (!available) return false;

  const content = Buffer.from(JSON.stringify(tracking, null, 2)).toString('base64');

  // Recupera SHA (necessário para update)
  let sha;
  const metaPath = localFile + '.sha';
  if (fs.existsSync(metaPath)) {
    sha = fs.readFileSync(metaPath, 'utf8').trim();
  } else {
    try {
      const { ok, data } = await githubRequest('GET', repo, token, TRACKING_REPO_PATH);
      if (ok && data?.sha) sha = data.sha;
    } catch { /* novo arquivo */ }
  }

  const hoje = new Date().toISOString().slice(0, 10);
  const body  = {
    message:   `chore: published-posts ${hoje}`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  try {
    const { ok, data } = await githubRequest('PUT', repo, token, TRACKING_REPO_PATH, body);
    if (ok && data?.content?.sha) {
      // Atualiza SHA para próximo commit
      fs.writeFileSync(metaPath, data.content.sha);
    }
    return ok;
  } catch (err) {
    console.warn(`⚠️ Falha ao commitar tracking no GitHub: ${err.message}`);
    return false;
  }
}

/**
 * Verifica se um tipo de publicação já ocorreu hoje (lê do GitHub).
 * @param {string} localFile — caminho do published-posts.json local
 * @param {string} tipo — ex: 'kling-reel', 'reel-6', 'carousel', 'story-video'
 * @param {string} dateStr — YYYY-MM-DD
 */
async function jaPublicouHoje(localFile, tipo, dateStr) {
  const tracking = await lerTrackingCompleto(localFile);
  return !!(tracking[dateStr]?.[tipo]);
}

module.exports = { lerTrackingCompleto, salvarTracking, jaPublicouHoje };
