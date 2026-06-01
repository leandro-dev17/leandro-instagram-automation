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

if (!ANTHROPIC_KEY) {
  console.error('ERRO: ANTHROPIC_API_KEY não configurada. Claude Resolver não pode operar.');
  process.exit(1);
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

// ── Implementação das ferramentas ─────────────────────────────────────────────

async function verificarRunsRecentes(horas = 6) {
  const desde = new Date(Date.now() - horas * 3600000).toISOString().slice(0, 10);
  const data  = await githubApi(`/actions/runs?created>=${desde}&per_page=50`);
  return (data.workflow_runs || [])
    .filter(r => new Date(r.created_at) >= new Date(Date.now() - horas * 3600000))
    .map(r => ({ id: r.id, status: r.status, conclusion: r.conclusion, criadoEm: r.created_at, workflow: r.path }));
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

async function atualizarSecretGitHub(nome, valor) {
  const ghToken = process.env.GH_TOKEN || GITHUB_TOKEN;
  const env     = { ...process.env, GH_TOKEN: ghToken };
  const result  = spawnSync('gh', ['secret', 'set', nome, '--repo', REPO, '--body', valor], {
    stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8', env,
  });
  return { ok: result.status === 0, nome, stderr: result.stderr?.trim() };
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
  return { totalDias: Object.keys(schedule).length, coberturaProximos8: proximos8 };
}

async function atualizarScheduleDia(dataISO, novoConteudo) {
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json') && f.startsWith('week-')).sort().reverse();
  for (const f of files) {
    const filePath  = path.join(SCHEDULE_DIR, f);
    const data      = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    if (data.days?.[dataISO] !== undefined) {
      data.days[dataISO] = { ...data.days[dataISO], ...novoConteudo };
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
      // Commita no GitHub
      const repoPath = `squads/leandro-instagram/automation/schedule/${f}`;
      const result   = await atualizarArquivo(repoPath, JSON.stringify(data, null, 2), `atualiza conteúdo de ${dataISO}`);
      return { ok: result.ok, arquivo: f, data: dataISO };
    }
  }
  return { ok: false, erro: `Data ${dataISO} não encontrada em nenhum schedule` };
}

async function gerarReceita(categoria) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1500,
    messages: [{
      role: 'user',
      content: `Gere 1 receita fit para mulheres categoria: ${categoria || 'lanche'}.
Responda APENAS com JSON:
{"id":"nome-kebab","title":"Título","headline":"Título\\nCurto","category":"${categoria || 'lanche'}","ingredients_display":["✅ ingrediente 1","✅ ingrediente 2","✅ ingrediente 3"],"caption":"Legenda completa com CTA e hashtags","hashtags":"#tag1 #tag2 #leandropersonall","image_prompt":"Professional food photography, [descrição detalhada]"}`,
    }],
  });
  const text  = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido');
  const receita = JSON.parse(match[0]);

  // Adiciona à última batch ou cria nova
  const files   = fs.readdirSync(RECIPES_DIR).filter(f => f.startsWith('batch') && f.endsWith('.json')).sort().reverse();
  const lastFile = files[0] || 'batch-01.json';
  const lastPath = path.join(RECIPES_DIR, lastFile);
  const batch    = JSON.parse(fs.readFileSync(lastPath, 'utf8'));
  batch.push(receita);
  fs.writeFileSync(lastPath, JSON.stringify(batch, null, 2));

  // Commita
  const repoPath = `squads/leandro-instagram/automation/recipes/${lastFile}`;
  await atualizarArquivo(repoPath, JSON.stringify(batch, null, 2), `adiciona receita ${receita.id}`);

  return { ok: true, receita: receita.title, arquivo: lastFile };
}

async function gerarTemasSemana() {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Gere 7 temas de conteúdo fitness feminino para a próxima semana do @leandro_personall.
Data de hoje: ${new Date().toLocaleDateString('pt-BR')}. Variados: treino, nutrição, motivação, receita.
Responda JSON: {"temas":[{"dia":"seg","tipo":"carousel","tema":"...","hook":"..."},{"dia":"ter","tipo":"kling",...},...]}`,
    }],
  });
  const text  = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  return match ? JSON.parse(match[0]) : { erro: 'Falha na geração' };
}

async function verificarPoolKling() {
  if (!fs.existsSync(POOL_DIR)) return { erro: 'Pool não encontrado', videos: 0 };
  const videos    = fs.readdirSync(POOL_DIR).filter(f => f.endsWith('.mp4'));
  const corte     = new Date(Date.now() - 14 * 86400000);
  const usados    = new Set();
  if (fs.existsSync(TRACKING_FILE)) {
    try {
      const tracking = JSON.parse(fs.readFileSync(TRACKING_FILE, 'utf8'));
      for (const [dateStr, posts] of Object.entries(tracking)) {
        if (new Date(dateStr) >= corte) {
          const vid = posts['kling-reel']?.videoId;
          if (vid) usados.add(vid);
        }
      }
    } catch { /* ignora */ }
  }
  const frescos = videos.filter(v => !usados.has(v.replace('.mp4', '')));
  return { totalVideos: videos.length, usadosUltimos14d: usados.size, frescos: frescos.length, status: frescos.length < 4 ? 'CRÍTICO' : frescos.length < 6 ? 'BAIXO' : 'OK' };
}

async function verificarEstoqueReceitas() {
  const tracker = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, 'recipe-tracker.json'), 'utf8'));
  const usedSet = new Set(tracker.used || []);
  let total = 0;
  fs.readdirSync(RECIPES_DIR).filter(f => f.startsWith('batch') && f.endsWith('.json')).forEach(f => {
    const items = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, f), 'utf8'));
    total += items.length;
  });
  return { total, usadas: usedSet.size, disponiveis: total - usedSet.size, status: (total - usedSet.size) < 15 ? 'BAIXO' : 'OK' };
}

// ── Invoca Claude com todas as ferramentas ─────────────────────────────────────

async function invocarClaude(tipo, descricao, dadosContexto) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const CONTEXTO = `
Você é o Agente Autônomo da automação de Instagram @leandro_personall (BioNexus Digital).

## Situação Atual
Tipo de problema: ${tipo}
Descrição: ${descricao}
${dadosContexto ? `Dados: ${JSON.stringify(dadosContexto, null, 2).slice(0, 1000)}` : ''}

## Sistema
- @leandro_personall: personal trainer feminino em Jaraguá do Sul, SC
- Automação publica diariamente: story (07h), kling reel (12h), carrossel (15h), reel receita (17:30h)
- GitHub Actions: leandro-dev17/leandro-instagram-automation
- Conteúdo gerado com Claude + imagens KIE.ai + vídeos Kling AI

## Sua missão
1. Diagnostique o problema com as ferramentas disponíveis
2. Resolva autonomamente tudo que puder (renovar token, gerar conteúdo, disparar jobs, corrigir código)
3. Se não puder resolver, explique o que precisa de ação humana
4. SEMPRE envie relatório final no Telegram

## Regras
- Prefira disparar_job para publicações (tem ffmpeg e todas as dependências)
- Use atualizar_arquivo para fixes de código (commita automaticamente)
- Ao renovar token, SEMPRE atualiza os secrets do GitHub também
- Seja autônomo: resolva o máximo possível sem precisar do Leandro
`.trim();

  const tools = [
    {
      name: 'verificar_runs_recentes',
      description: 'Lista os runs recentes do GitHub Actions (últimas N horas).',
      input_schema: { type: 'object', properties: { horas: { type: 'number' } }, required: [] },
    },
    {
      name: 'ler_log_run',
      description: 'Detalha os jobs e erros de um run específico.',
      input_schema: { type: 'object', properties: { run_id: { type: 'number' } }, required: ['run_id'] },
    },
    {
      name: 'ler_arquivo',
      description: 'Lê qualquer arquivo do repositório (código, schedule, logs, etc).',
      input_schema: { type: 'object', properties: { file_path: { type: 'string', description: 'Caminho relativo: squads/leandro-instagram/automation/...' } }, required: ['file_path'] },
    },
    {
      name: 'atualizar_arquivo',
      description: 'Commita uma correção de código no repositório. Para bugs confirmados.',
      input_schema: { type: 'object', properties: { file_path: { type: 'string' }, novo_conteudo: { type: 'string' }, mensagem: { type: 'string' } }, required: ['file_path', 'novo_conteudo', 'mensagem'] },
    },
    {
      name: 'disparar_job',
      description: 'Aciona um job via GitHub Actions. Para publicações, prefira isso (tem ffmpeg e todas as libs). Jobs disponíveis: daily-generator, story-07h, carousel-12h, reel-dica-1730h, kling-reel-20h, fiscal-cronograma, gerador-receitas, agente-trending, qualidade-copy.',
      input_schema: { type: 'object', properties: { workflow_id: { type: 'string', description: 'bionexus-daily.yml ou bionexus-weekly.yml' }, job_id: { type: 'string' }, motivo: { type: 'string' } }, required: ['job_id', 'motivo'] },
    },
    {
      name: 'testar_token_instagram',
      description: 'Testa se o token do Instagram está válido e verifica dias restantes antes do vencimento.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'renovar_token_instagram',
      description: 'Renova o token do Instagram via API (válido por mais 60 dias) e atualiza os secrets do GitHub automaticamente.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'listar_posts_instagram',
      description: 'Lista os posts recentes do Instagram com métricas (likes, comentários).',
      input_schema: { type: 'object', properties: { quantidade: { type: 'number', description: 'Quantidade de posts (padrão 10)' } }, required: [] },
    },
    {
      name: 'obter_insights_instagram',
      description: 'Obtém métricas de alcance, impressões e visitas ao perfil.',
      input_schema: { type: 'object', properties: { periodo: { type: 'string', description: 'week ou day' } }, required: [] },
    },
    {
      name: 'ler_schedule',
      description: 'Lê o cronograma semanal e mostra cobertura dos próximos 8 dias.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'atualizar_schedule_dia',
      description: 'Atualiza o conteúdo de um dia específico no cronograma semanal.',
      input_schema: {
        type: 'object',
        properties: {
          data: { type: 'string', description: 'YYYY-MM-DD' },
          conteudo: { type: 'object', description: 'Campos a atualizar: story.topic, carousel.topic, reel_kling.topic, etc.' },
        },
        required: ['data', 'conteudo'],
      },
    },
    {
      name: 'gerar_receita_nova',
      description: 'Usa Claude para gerar uma nova receita fit e adicioná-la ao banco de receitas.',
      input_schema: { type: 'object', properties: { categoria: { type: 'string', description: 'café da manhã, almoço, lanche, pré-treino, pós-treino, etc.' } }, required: [] },
    },
    {
      name: 'gerar_temas_semana',
      description: 'Gera sugestões de temas de conteúdo para a próxima semana.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'verificar_pool_kling',
      description: 'Verifica quantos vídeos Kling estão disponíveis (não usados nos últimos 14 dias).',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'verificar_estoque_receitas',
      description: 'Verifica quantas receitas estão disponíveis no banco de receitas.',
      input_schema: { type: 'object', properties: {}, required: [] },
    },
    {
      name: 'enviar_telegram',
      description: 'Envia qualquer mensagem para o Telegram do Leandro.',
      input_schema: { type: 'object', properties: { mensagem: { type: 'string' } }, required: ['mensagem'] },
    },
    {
      name: 'enviar_relatorio_final',
      description: 'OBRIGATÓRIO ao final. Envia relatório completo de diagnóstico e ações tomadas.',
      input_schema: {
        type: 'object',
        properties: {
          diagnostico:                { type: 'string' },
          acoes_tomadas:              { type: 'string' },
          precisa_intervencao_humana: { type: 'boolean' },
          instrucoes_para_leandro:    { type: 'string', description: 'O que o Leandro precisa fazer manualmente (se necessário)' },
        },
        required: ['diagnostico', 'acoes_tomadas', 'precisa_intervencao_humana'],
      },
    },
  ];

  const messages = [{ role: 'user', content: CONTEXTO }];
  const acoes    = [];
  let relatorio  = null;

  for (let i = 0; i < 20; i++) {
    const response = await client.messages.create({
      model:      'claude-opus-4-8',
      max_tokens: 8192,
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason !== 'tool_use') break;

    const results = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let resultado = '';

      try {
        switch (block.name) {
          case 'verificar_runs_recentes':
            resultado = await verificarRunsRecentes(block.input.horas || 6); break;
          case 'ler_log_run':
            resultado = await lerLogRun(block.input.run_id); break;
          case 'ler_arquivo':
            resultado = await lerArquivo(block.input.file_path); break;
          case 'atualizar_arquivo':
            resultado = await atualizarArquivo(block.input.file_path, block.input.novo_conteudo, block.input.mensagem);
            if (resultado.ok) acoes.push(`✅ Código corrigido: ${block.input.file_path}`);
            break;
          case 'disparar_job':
            resultado = await dispararJob(block.input.workflow_id, block.input.job_id, block.input.motivo);
            if (resultado.ok) acoes.push(`🔄 Job disparado: ${block.input.job_id} — ${block.input.motivo}`);
            break;
          case 'testar_token_instagram':
            resultado = await testarTokenInstagram(); break;
          case 'renovar_token_instagram':
            resultado = await renovarTokenInstagram();
            if (resultado.ok) acoes.push(`🔐 Token Instagram renovado até ${resultado.novaExpiracao}`);
            break;
          case 'listar_posts_instagram':
            resultado = await listarPostsInstagram(block.input.quantidade || 10); break;
          case 'obter_insights_instagram':
            resultado = await obterInsightsInstagram(block.input.periodo || 'week'); break;
          case 'ler_schedule':
            resultado = lerScheduleLocal(); break;
          case 'atualizar_schedule_dia':
            resultado = await atualizarScheduleDia(block.input.data, block.input.conteudo);
            if (resultado.ok) acoes.push(`📅 Schedule atualizado: ${block.input.data}`);
            break;
          case 'gerar_receita_nova':
            resultado = await gerarReceita(block.input.categoria);
            if (resultado.ok) acoes.push(`🍳 Nova receita gerada: ${resultado.receita}`);
            break;
          case 'gerar_temas_semana':
            resultado = await gerarTemasSemana(); break;
          case 'verificar_pool_kling':
            resultado = await verificarPoolKling(); break;
          case 'verificar_estoque_receitas':
            resultado = await verificarEstoqueReceitas(); break;
          case 'enviar_telegram':
            resultado = await enviarTelegram(block.input.mensagem); break;
          case 'enviar_relatorio_final':
            relatorio = block.input;
            resultado = 'Relatório registrado';
            break;
          default:
            resultado = `Ferramenta desconhecida: ${block.name}`;
        }
      } catch (err) {
        resultado = `Erro ao executar ${block.name}: ${err.message}`;
      }

      results.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(resultado) });
    }

    messages.push({ role: 'user', content: results });
  }

  return { relatorio, acoes };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args        = process.argv.slice(2);
  const tipo        = args[0] || 'erro_generico';
  const descricao   = args[1] || 'Problema sem descrição específica';
  const dadosRaw    = args[2];
  const dados       = dadosRaw ? JSON.parse(dadosRaw) : null;

  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  console.log(`[claude-resolver] 🤖 Ativado — ${tipo}: ${descricao.slice(0, 80)}`);

  await enviarTelegram(
    `🤖 <b>Claude Resolver — ativado</b>\n\n` +
    `Tipo: <code>${tipo}</code>\n` +
    `Situação: ${descricao.slice(0, 200)}\n` +
    `Horário: ${hora} BRT\n\n` +
    `<i>Investigando e resolvendo autonomamente...</i>`
  );

  let relatorio = null;
  let acoes     = [];

  try {
    const resultado = await invocarClaude(tipo, descricao, dados);
    relatorio       = resultado.relatorio;
    acoes           = resultado.acoes;
  } catch (err) {
    console.error('Erro ao invocar Claude:', err.message);
    await enviarTelegram(
      `🔴 <b>Claude Resolver — ERRO INTERNO</b>\n\n` +
      `${err.message.slice(0, 300)}\n\n` +
      `⚠️ <b>Leandro, verificação manual necessária!</b>\n` +
      `Acesse: github.com/${REPO}/actions`
    );
    process.exit(1);
  }

  // Relatório final
  if (relatorio) {
    const r     = relatorio;
    const icone = r.precisa_intervencao_humana ? '🚨' : '🤖✅';

    await enviarTelegram(
      `${icone} <b>Claude Resolver — ${tipo}</b>\n\n` +
      `🔍 <b>Diagnóstico:</b>\n${String(r.diagnostico).slice(0, 500)}\n\n` +
      `🔧 <b>Ações tomadas:</b>\n${acoes.length > 0 ? acoes.join('\n') : String(r.acoes_tomadas || 'Nenhuma').slice(0, 400)}` +
      (r.precisa_intervencao_humana && r.instrucoes_para_leandro
        ? `\n\n⚠️ <b>Ação necessária:</b>\n${String(r.instrucoes_para_leandro).slice(0, 300)}`
        : r.precisa_intervencao_humana
          ? `\n\n⚠️ <b>Leandro, verificação manual necessária!</b>`
          : `\n\n✅ <b>Resolvido automaticamente!</b>`)
    );
  } else {
    await enviarTelegram(
      `🤖 <b>Claude Resolver — ${tipo}</b>\n` +
      `Análise concluída.\n` +
      (acoes.length > 0 ? `Ações: ${acoes.join(' | ')}` : 'Nenhuma ação necessária.')
    );
  }

  console.log(`[claude-resolver] Concluído. Ações: ${acoes.join(', ') || 'nenhuma'}`);
}

main().catch(err => {
  console.error('ERRO FATAL claude-resolver:', err.message);
  process.exit(1);
});
