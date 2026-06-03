#!/usr/bin/env node
'use strict';

/**
 * fiscal-conteudo-semana.cjs — Taxa de Publicação Semanal por Tipo
 *
 * Roda diariamente às 20:15 BRT (23:15 UTC).
 * Verifica quantas vezes cada tipo de conteúdo publicou nos últimos 7 dias.
 *
 * Mínimos esperados (7 dias):
 * - Story:    >= 6/7 dias
 * - Carrossel: >= 5/7 dias
 * - Kling:    >= 5/7 dias
 * - Receita:  >= 3/7 dias (nova frequência: 4x/semana)
 *
 * Detecta silenciosamente quando o kling para de publicar
 * (o que aconteceu por dias sem nenhum alerta anteriormente).
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
const { salvarResultado } = require('./lib/fiscal-resultado.cjs');

// Contagens mínimas esperadas por semana (7 dias)
const MINIMOS = {
  story:    { min: 6, label: '📸 Story',     jobId: 'story-07h'       },
  kling:    { min: 5, label: '🎬 Kling',     jobId: 'kling-reel-20h'  },
  carousel: { min: 5, label: '📋 Carrossel', jobId: 'carousel-12h'    },
  receita:  { min: 3, label: '🍳 Receita',   jobId: 'reel-dica-1730h' },
};

const JOB_PARA_TIPO = {
  'story-07h':       'story',
  'kling-reel-20h':  'kling',
  'carousel-12h':    'carousel',
  'reel-dica-1730h': 'receita',
};

async function githubApi(endpoint) {
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-FiscalConteudo/1.0',
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`GitHub API ${endpoint}: ${res.status}`);
  return res.json();
}

// Sem envio direto ao Telegram — o guardião aciona Claude que notifica

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[fiscal-conteudo-semana] Auditando taxa semanal — ${data}`);

  // Busca runs dos últimos 7 dias
  const sete  = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
  const runsData = await githubApi(`/actions/runs?created>=${sete}&per_page=100`);
  const runs = (runsData.workflow_runs || []).filter(r =>
    r.path?.includes('bionexus-daily') || r.name?.includes('Diárias')
  );

  // Conta publicações bem-sucedidas por tipo
  const contagem = { story: 0, kling: 0, carousel: 0, receita: 0 };
  const diasPorTipo = { story: new Set(), kling: new Set(), carousel: new Set(), receita: new Set() };

  for (const run of runs) {
    const dia = run.created_at?.slice(0, 10);
    let jobsData;
    try { jobsData = await githubApi(`/actions/runs/${run.id}/jobs`); } catch { continue; }
    for (const job of (jobsData.jobs || [])) {
      const tipo = JOB_PARA_TIPO[job.name];
      if (tipo && job.conclusion === 'success' && !diasPorTipo[tipo].has(dia)) {
        diasPorTipo[tipo].add(dia);
        contagem[tipo]++;
      }
    }
  }

  console.log('Publicações últimos 7 dias:', JSON.stringify(contagem));

  // Compara com mínimos
  const problemas = [];
  const avisos    = [];
  const linhas    = [];

  for (const [tipo, cfg] of Object.entries(MINIMOS)) {
    const qtd     = contagem[tipo];
    const pct     = Math.round(qtd / 7 * 100);
    const ok      = qtd >= cfg.min;
    const critico = qtd < cfg.min - 1;

    const icon = ok ? '✅' : critico ? '❌' : '⚠️';
    linhas.push(`${icon} ${cfg.label}: ${qtd}/7 dias (mín ${cfg.min})`);

    if (critico) problemas.push(`${cfg.label}: apenas ${qtd}/7 dias (mín esperado ${cfg.min})`);
    else if (!ok) avisos.push(`${cfg.label}: ${qtd}/7 dias — abaixo do ideal`);
  }

  if (problemas.length === 0 && avisos.length === 0) {
    console.log('✅ Taxa de publicação OK.');
    return;
  }

  salvarResultado('conteudo-semana', problemas, avisos, {
    contagem, linhas,
    instrucao: 'Verifique os jobs que falharam na semana em github.com/' + REPO + '/actions e dispare recuperação.',
  });
  console.log(linhas.join('\n'));
  if (problemas.length > 0) process.exit(1);
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-conteudo-semana:', err.message);
  process.exit(1);
});
