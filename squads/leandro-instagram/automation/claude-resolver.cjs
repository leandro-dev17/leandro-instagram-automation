#!/usr/bin/env node
'use strict';

/**
 * claude-resolver.cjs — Último recurso: Claude Anthropic resolve o problema
 *
 * Adaptado do claude-resolver da Vovó Teresinha para o contexto de
 * automação de Instagram via GitHub Actions (sem banco de dados).
 *
 * Acionado pelo guardiao.cjs quando um job falha 3+ vezes consecutivas.
 *
 * Claude recebe:
 * - O job que está falhando e quantas vezes falhou
 * - Ferramentas para investigar e corrigir
 *
 * Ferramentas disponíveis ao Claude:
 * - verificar_runs_recentes: histórico de runs do GitHub Actions
 * - ler_log_run: lê o log de um run específico
 * - ler_arquivo: lê o conteúdo de um arquivo do repositório
 * - disparar_job: aciona um job via workflow_dispatch
 * - atualizar_arquivo: commita uma correção de código no repositório
 * - enviar_relatorio: relatório final via Telegram (obrigatório)
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

const ANTHROPIC_KEY  = process.env.ANTHROPIC_API_KEY;
const REPO           = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID;
const WORKFLOW_ID    = 'bionexus-daily.yml';

if (!ANTHROPIC_KEY) {
  console.error('ERRO: ANTHROPIC_API_KEY não configurada. Claude Resolver não pode operar.');
  process.exit(1);
}

// ── APIs externas ─────────────────────────────────────────────────────────────

async function githubApi(endpoint, method = 'GET', body = null) {
  const opts = {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Claude-Resolver/1.0',
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

// ── Implementação das ferramentas do Claude ───────────────────────────────────

async function verificarRunsRecentes(horas = 4) {
  const desde = new Date(Date.now() - horas * 3600000).toISOString();
  const data  = await githubApi(`/actions/runs?created>=${desde.slice(0, 10)}&per_page=50`);
  const runs  = (data.workflow_runs || [])
    .filter(r => new Date(r.created_at) >= new Date(Date.now() - horas * 3600000))
    .map(r => ({
      id:         r.id,
      status:     r.status,
      conclusion: r.conclusion,
      workflow:   r.path,
      criadoEm:   r.created_at,
      url:        r.html_url,
    }));
  return { total: runs.length, runs: runs.slice(0, 20) };
}

async function lerLogRun(runId) {
  const jobsData = await githubApi(`/actions/runs/${runId}/jobs`);
  const jobs = (jobsData.jobs || []).map(j => ({
    nome:       j.name,
    status:     j.status,
    conclusion: j.conclusion,
    steps: (j.steps || []).filter(s => s.conclusion === 'failure' || s.name.includes('Rodar') || s.name.includes('Publicar')).map(s => ({
      nome:       s.name,
      status:     s.status,
      conclusion: s.conclusion,
    })),
  }));

  // Tenta baixar o log completo (comprimido)
  let logTrecho = '';
  try {
    const logRes = await fetch(`https://api.github.com/repos/${REPO}/actions/runs/${runId}/logs`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (logRes.ok) {
      logTrecho = `Log disponível em: https://github.com/${REPO}/actions/runs/${runId}`;
    }
  } catch { /* silencioso */ }

  return { runId, jobs, logTrecho };
}

async function lerArquivo(filePath) {
  try {
    const data = await githubApi(`/contents/${filePath}`);
    if (data.content) {
      const conteudo = Buffer.from(data.content, 'base64').toString('utf8');
      return { filePath, conteudo: conteudo.slice(0, 8000), tamanho: conteudo.length, sha: data.sha };
    }
    return { filePath, erro: 'Arquivo não encontrado ou binário' };
  } catch (err) {
    return { filePath, erro: err.message };
  }
}

async function dispararJob(jobId, motivo) {
  const res = await githubApi(
    `/actions/workflows/${WORKFLOW_ID}/dispatches`,
    'POST',
    { ref: 'main', inputs: { job: jobId } }
  );
  return { ok: res.ok !== false, jobId, motivo };
}

async function atualizarArquivo(filePath, novoConteudo, mensagemCommit) {
  // Lê SHA atual
  let sha;
  try {
    const atual = await githubApi(`/contents/${filePath}`);
    sha = atual.sha;
  } catch { /* arquivo novo */ }

  const content = Buffer.from(novoConteudo).toString('base64');
  const body = {
    message: `fix(auto): ${mensagemCommit}`,
    content,
    committer: { name: 'BioNexus Claude Resolver', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  try {
    const result = await githubApi(`/contents/${filePath}`, 'PUT', body);
    return { ok: !!result.content?.sha, filePath, mensagemCommit };
  } catch (err) {
    return { ok: false, filePath, erro: err.message };
  }
}

// ── Agente Claude com ferramentas ─────────────────────────────────────────────

async function invocarClaude(jobFalhando, quantasFalhas, erroDetalhado) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk').catch(() => {
    // Tenta require como fallback
    const mod = require('@anthropic-ai/sdk');
    return { default: mod.default || mod };
  });

  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const contexto = `
Você é o Agente de Recuperação Autônomo da automação de Instagram @leandro_personall.

## Situação Crítica
Job "${jobFalhando}" falhou ${quantasFalhas} vezes nas últimas 2 horas.
${erroDetalhado ? `Erro detectado: ${erroDetalhado}` : ''}

## Arquitetura do sistema
- Automação via GitHub Actions (repositório: ${REPO})
- Scripts Node.js (.cjs) em squads/leandro-instagram/automation/
- Workflow principal: .github/workflows/bionexus-daily.yml
- Jobs diários: daily-generator (05h), story-07h (07h), kling-reel-20h (12h), carousel-12h (15h), reel-dica-1730h (17:30h) — BRT

## Sua missão
1. Investigue a causa raiz usando as ferramentas
2. Aplique correções quando possível (retry do job, ajuste de configuração, fix de código)
3. Envie relatório completo ao final (OBRIGATÓRIO)

## Ferramentas disponíveis
- verificar_runs_recentes: lista runs das últimas N horas
- ler_log_run: detalha o que aconteceu num run específico
- ler_arquivo: lê o conteúdo de um arquivo do repositório
- disparar_job: aciona um job via workflow_dispatch (retry)
- atualizar_arquivo: commita uma correção de código (use com cuidado)
- enviar_relatorio: relatório final Telegram (OBRIGATÓRIO ao final)

Comece investigando os runs recentes, depois leia o código do job que está falhando.
`.trim();

  const tools = [
    {
      name: 'verificar_runs_recentes',
      description: 'Lista os runs recentes do GitHub Actions para diagnóstico.',
      input_schema: {
        type: 'object',
        properties: {
          horas: { type: 'number', description: 'Quantas horas para trás verificar (padrão: 4)' },
        },
        required: [],
      },
    },
    {
      name: 'ler_log_run',
      description: 'Detalhes e logs de um run específico do GitHub Actions.',
      input_schema: {
        type: 'object',
        properties: {
          run_id: { type: 'number', description: 'ID do run a inspecionar' },
        },
        required: ['run_id'],
      },
    },
    {
      name: 'ler_arquivo',
      description: 'Lê o conteúdo de um arquivo do repositório para diagnóstico de código.',
      input_schema: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Caminho relativo do arquivo (ex: squads/leandro-instagram/automation/story-publisher-new.cjs)' },
        },
        required: ['file_path'],
      },
    },
    {
      name: 'disparar_job',
      description: 'Aciona um job específico via workflow_dispatch para retry.',
      input_schema: {
        type: 'object',
        properties: {
          job_id: { type: 'string', description: 'ID do job (ex: story-07h, carousel-12h, kling-reel-20h, reel-dica-1730h, daily-generator)' },
          motivo: { type: 'string', description: 'Por que está acionando este retry' },
        },
        required: ['job_id', 'motivo'],
      },
    },
    {
      name: 'atualizar_arquivo',
      description: 'Commita uma correção de código no repositório. Use APENAS quando tiver certeza do fix.',
      input_schema: {
        type: 'object',
        properties: {
          file_path:         { type: 'string', description: 'Caminho do arquivo a corrigir' },
          novo_conteudo:     { type: 'string', description: 'Conteúdo completo corrigido do arquivo' },
          mensagem_commit:   { type: 'string', description: 'Descrição clara do que foi corrigido e por quê' },
        },
        required: ['file_path', 'novo_conteudo', 'mensagem_commit'],
      },
    },
    {
      name: 'enviar_relatorio',
      description: 'OBRIGATÓRIO ao final. Envia relatório completo via Telegram ao Leandro.',
      input_schema: {
        type: 'object',
        properties: {
          diagnostico:             { type: 'string', description: 'Causa raiz identificada' },
          acoes_tomadas:           { type: 'string', description: 'O que foi feito para corrigir' },
          codigo_sugerido:         { type: 'string', description: 'Se houver fix de código, o trecho corrigido' },
          arquivo_sugerido:        { type: 'string', description: 'Arquivo que precisa ser alterado' },
          precisa_intervencao_humana: { type: 'boolean', description: 'Verdadeiro se Leandro precisa agir manualmente' },
        },
        required: ['diagnostico', 'acoes_tomadas', 'precisa_intervencao_humana'],
      },
    },
  ];

  const messages = [{ role: 'user', content: contexto }];
  const acoesTomadas = [];
  let relatorioFinal = null;

  for (let i = 0; i < 15; i++) {
    const response = await client.messages.create({
      model:      'claude-opus-4-8',
      max_tokens: 4096,
      tools,
      messages,
    });

    messages.push({ role: 'assistant', content: response.content });
    if (response.stop_reason !== 'tool_use') break;

    const toolResults = [];
    for (const block of response.content) {
      if (block.type !== 'tool_use') continue;
      let resultado = '';

      try {
        switch (block.name) {
          case 'verificar_runs_recentes':
            resultado = await verificarRunsRecentes(block.input.horas || 4);
            break;
          case 'ler_log_run':
            resultado = await lerLogRun(block.input.run_id);
            break;
          case 'ler_arquivo':
            resultado = await lerArquivo(block.input.file_path);
            break;
          case 'disparar_job': {
            const r = await dispararJob(block.input.job_id, block.input.motivo);
            acoesTomadas.push(`Retry: ${block.input.job_id} — ${block.input.motivo}`);
            resultado = r;
            break;
          }
          case 'atualizar_arquivo': {
            const r = await atualizarArquivo(
              block.input.file_path,
              block.input.novo_conteudo,
              block.input.mensagem_commit
            );
            if (r.ok) acoesTomadas.push(`Código corrigido: ${block.input.file_path}`);
            resultado = r;
            break;
          }
          case 'enviar_relatorio':
            relatorioFinal = block.input;
            resultado = 'Relatório registrado';
            break;
        }
      } catch (err) {
        resultado = `Erro ao executar ferramenta: ${err.message}`;
      }

      toolResults.push({
        type: 'tool_result',
        tool_use_id: block.id,
        content: JSON.stringify(resultado),
      });
    }

    messages.push({ role: 'user', content: toolResults });
  }

  return { relatorioFinal, acoesTomadas };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  const args        = process.argv.slice(2);
  const jobFalhando = args[0] || 'desconhecido';
  const falhas      = parseInt(args[1]) || 3;
  const erro        = args.slice(2).join(' ') || '';

  const hora = new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });

  console.log(`[claude-resolver] 🤖 Ativado para: ${jobFalhando} (${falhas}x falhas)`);

  await enviarTelegram(
    `🤖 <b>Claude Resolver — ativado</b>\n\n` +
    `Job: <code>${jobFalhando}</code>\n` +
    `Falhas: ${falhas}x nas últimas 2h\n` +
    `Horário: ${hora} BRT\n\n` +
    `<i>Investigando e tentando resolver automaticamente...</i>`
  );

  let relatorioFinal = null;
  let acoesTomadas   = [];

  try {
    const resultado = await invocarClaude(jobFalhando, falhas, erro);
    relatorioFinal  = resultado.relatorioFinal;
    acoesTomadas    = resultado.acoesTomadas;
  } catch (err) {
    console.error('Erro ao invocar Claude:', err.message);
    await enviarTelegram(
      `🔴 <b>Claude Resolver — ERRO INTERNO</b>\n\n` +
      `Job: ${jobFalhando}\n` +
      `Erro: ${err.message.slice(0, 200)}\n\n` +
      `⚠️ <b>Leandro, intervenção manual necessária!</b>\n` +
      `Acesse: github.com/${REPO}/actions`
    );
    process.exit(1);
  }

  // Envia relatório final
  if (relatorioFinal) {
    const r     = relatorioFinal;
    const icone = r.precisa_intervencao_humana ? '🚨' : '🤖✅';

    let msg =
      `${icone} <b>Claude Resolver — ${jobFalhando}</b>\n\n` +
      `🔍 <b>Diagnóstico:</b>\n${String(r.diagnostico).slice(0, 500)}\n\n` +
      `🔧 <b>Ações tomadas:</b>\n${String(r.acoes_tomadas || 'Nenhuma ação automática').slice(0, 400)}`;

    if (r.codigo_sugerido && r.arquivo_sugerido) {
      msg +=
        `\n\n📝 <b>Correção aplicada em:</b>\n<code>${r.arquivo_sugerido}</code>`;
    }

    msg += r.precisa_intervencao_humana
      ? `\n\n⚠️ <b>Leandro, atenção necessária!</b>\nAcesse: github.com/${REPO}/actions`
      : `\n\n✅ <b>Resolvido automaticamente.</b>`;

    await enviarTelegram(msg);
  } else {
    await enviarTelegram(
      `🤖 <b>Claude Resolver — ${jobFalhando}</b>\n` +
      `Ações: ${acoesTomadas.join('; ') || 'análise concluída sem ações'}\n` +
      `Acesse os logs: github.com/${REPO}/actions`
    );
  }

  console.log(`[claude-resolver] Concluído. Ações: ${acoesTomadas.join(', ') || 'nenhuma'}`);
}

main().catch(err => {
  console.error('ERRO FATAL claude-resolver:', err.message);
  process.exit(1);
});
