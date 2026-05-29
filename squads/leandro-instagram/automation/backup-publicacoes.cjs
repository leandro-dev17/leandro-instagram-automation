#!/usr/bin/env node
'use strict';

/**
 * backup-publicacoes.cjs — Backup do Histórico de Publicações
 *
 * Roda ao final do dia (23:50 UTC / 20:50 BRT) via GitHub Actions.
 * Consulta a API do GitHub para listar os runs do dia, mapeia o que
 * publicou com sucesso e faz commit do histórico no repositório.
 *
 * Resolve o problema: published-posts.json só existia na máquina local.
 * Agora o histórico é versionado no GitHub em logs/historico-YYYY-MM.json.
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
const LOGS_DIR     = path.join(__dirname, 'logs');
const WORKFLOW_ID  = 'bionexus-daily.yml';

const JOB_LABELS = {
  'daily-generator': { label: 'Gerador',    tipo: 'infra'    },
  'story-07h':       { label: 'Story',      tipo: 'story'    },
  'kling-reel-20h':  { label: 'Kling Reel', tipo: 'kling'    },
  'carousel-12h':    { label: 'Carrossel',  tipo: 'carousel' },
  'reel-dica-1730h': { label: 'Reel Receita', tipo: 'reel'   },
};

async function githubApi(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Backup/1.0',
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, opts);
  if (!res.ok && method === 'GET') throw new Error(`GitHub API: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function getJobsHoje() {
  const hoje = new Date().toISOString().slice(0, 10);
  const data = await githubApi(`/actions/runs?created>=${hoje}&per_page=100`);
  const runs = (data.workflow_runs || []).filter(r =>
    r.path?.includes('bionexus-daily') || r.name?.includes('Diárias')
  );

  const jobsStatus = {};
  for (const run of runs) {
    let jobsData;
    try { jobsData = await githubApi(`/actions/runs/${run.id}/jobs`); } catch { continue; }
    for (const job of (jobsData.jobs || [])) {
      if (JOB_LABELS[job.name] && !jobsStatus[job.name]) {
        jobsStatus[job.name] = {
          conclusion:  job.conclusion,
          completedAt: job.completed_at,
          runId:       run.id,
        };
      }
    }
  }
  return jobsStatus;
}

async function commitarHistorico(conteudo, filePath, commitMsg) {
  // Lê SHA atual do arquivo (se existir)
  let sha;
  try {
    const atual = await githubApi(`/contents/${filePath}`);
    sha = atual.sha;
  } catch { /* arquivo novo */ }

  const content = Buffer.from(JSON.stringify(conteudo, null, 2)).toString('base64');
  const body = { message: commitMsg, content, committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' } };
  if (sha) body.sha = sha;

  const res = await githubApi(`/contents/${filePath}`, 'PUT', body);
  return res.content?.sha ? true : false;
}

async function main() {
  const hoje   = new Date().toISOString().slice(0, 10);
  const mesAno = hoje.slice(0, 7); // YYYY-MM
  const hora   = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  console.log(`[backup-publicacoes] Fazendo backup do dia ${hoje}`);

  // Coleta o que rodou hoje
  let jobsHoje = {};
  try {
    jobsHoje = await getJobsHoje();
  } catch (err) {
    console.warn('⚠️ Não conseguiu consultar GitHub API:', err.message);
  }

  // Monta entrada do dia
  const entradaDia = {
    data: hoje,
    geradoEm: new Date().toISOString(),
    publicacoes: {},
  };

  for (const [jobId, info] of Object.entries(jobsHoje)) {
    if (!JOB_LABELS[jobId] || JOB_LABELS[jobId].tipo === 'infra') continue;
    entradaDia.publicacoes[JOB_LABELS[jobId].tipo] = {
      label:       JOB_LABELS[jobId].label,
      status:      info.conclusion,
      concluiuEm:  info.completedAt,
      runId:       info.runId,
    };
  }

  // Lê histórico mensal existente (do repositório)
  const historicoPath = `squads/leandro-instagram/automation/logs/historico-${mesAno}.json`;
  let historico = { mes: mesAno, dias: {} };

  try {
    const arquivoAtual = await githubApi(`/contents/${historicoPath}`);
    const conteudo = Buffer.from(arquivoAtual.content, 'base64').toString('utf8');
    historico = JSON.parse(conteudo);
  } catch { /* arquivo não existe ainda — cria novo */ }

  historico.dias[hoje] = entradaDia;

  // Commit no repositório
  const totalOK = Object.values(entradaDia.publicacoes).filter(p => p.status === 'success').length;
  const totalJobs = Object.keys(entradaDia.publicacoes).length;

  let committed = false;
  try {
    committed = await commitarHistorico(
      historico,
      historicoPath,
      `chore: histórico de publicações ${hoje} (${totalOK}/${totalJobs} OK)`
    );
  } catch (err) {
    console.warn('⚠️ Falha ao commitar histórico:', err.message);
  }

  if (!committed) {
    // Salva localmente como fallback
    if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
    const localPath = path.join(LOGS_DIR, `historico-${mesAno}.json`);
    fs.writeFileSync(localPath, JSON.stringify(historico, null, 2));
    console.log(`Salvo localmente em: ${localPath}`);
  }

  console.log(`✅ Backup concluído — ${hoje}: ${totalOK}/${totalJobs} publicações OK`);
}

main().catch(err => {
  console.error('ERRO FATAL backup-publicacoes:', err.message);
  // Não falha o job por isso — é só backup
});
