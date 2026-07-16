#!/usr/bin/env node
'use strict';

/**
 * agente-hashtags.cjs — Pesquisa e Atualização de Hashtags
 *
 * Roda no dia 15 de cada mês às 08:00 BRT.
 * IA (Groq→Cerebras) analisa o nicho de fitness feminino brasileiro e gera uma lista
 * atualizada e ranqueada de hashtags por categoria.
 *
 * Salva em schedule/hashtags-recomendadas.json — weekly-planner e publishers
 * podem ler esse arquivo para usar hashtags atualizadas.
 *
 * Categorias geradas:
 * - alcance (alta competição, volume alto — awareness)
 * - engajamento (média competição, nicho engajado)
 * - nicho (baixa competição, seguidores qualificados)
 * - locais (Jaraguá do Sul, SC, região)
 * - trending (temas em alta nesse mês)
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

const { gerarTexto } = require('./lib/ai-helper.cjs');

const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const REPO          = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const SCHEDULE_DIR  = path.join(__dirname, 'schedule');
const HASHTAGS_FILE = path.join(SCHEDULE_DIR, 'hashtags-recomendadas.json');
const HASHTAGS_REPO = 'squads/leandro-instagram/automation/schedule/hashtags-recomendadas.json';

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function gerarHashtags() {
  const mesAtual  = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  const estacao   = ['junho', 'julho', 'agosto'].includes(new Date().toLocaleDateString('pt-BR', { month: 'long' }).toLowerCase()) ? 'inverno' :
                    ['setembro', 'outubro', 'novembro'].includes(new Date().toLocaleDateString('pt-BR', { month: 'long' }).toLowerCase()) ? 'primavera' :
                    ['dezembro', 'janeiro', 'fevereiro'].includes(new Date().toLocaleDateString('pt-BR', { month: 'long' }).toLowerCase()) ? 'verão' : 'outono';

  const prompt = `Você é especialista em estratégia de hashtags para Instagram fitness feminino no Brasil.

PERFIL: @leandro_personall — Personal trainer feminino em Jaraguá do Sul, SC
PÚBLICO: Mulheres 25-45 anos, emagrecimento, treino feminino, receitas fit
PERÍODO: ${mesAtual} (${estacao})

Gere uma lista estratégica de hashtags atualizada para ${mesAtual}.

ESTRATÉGIA:
- alcance: hashtags com muitos posts (>500k) para descoberta em massa
- engajamento: hashtags com 50k-500k posts — boa relação alcance/nicho
- nicho: hashtags com <50k posts — seguidores qualificados, alta conversão
- locais: hashtags geográficas para atrair clientes de Jaraguá do Sul e SC
- trending: hashtags em alta AGORA no fitness feminino brasileiro (${estacao})

Responda APENAS JSON:
{
  "geradoEm": "${new Date().toISOString().slice(0,10)}",
  "mes": "${mesAtual}",
  "estacao": "${estacao}",
  "categorias": {
    "alcance": {
      "descricao": "Alta competição, grande alcance",
      "hashtags": ["#hashtag1", "#hashtag2"],
      "uso_recomendado": "2-3 por post para awareness"
    },
    "engajamento": {
      "descricao": "Equilíbrio alcance e qualidade",
      "hashtags": ["#hashtag1", "#hashtag2"],
      "uso_recomendado": "4-5 por post"
    },
    "nicho": {
      "descricao": "Baixa competição, seguidores qualificados",
      "hashtags": ["#hashtag1", "#hashtag2"],
      "uso_recomendado": "5-8 por post — converte melhor"
    },
    "locais": {
      "descricao": "Geolocalização para captação presencial",
      "hashtags": ["#jaragua", "#sc", "#santacatarina"],
      "uso_recomendado": "2-3 sempre que possível"
    },
    "trending": {
      "descricao": "Em alta nesse mês",
      "hashtags": ["#hashtag1", "#hashtag2"],
      "uso_recomendado": "1-2 para capitalizar tendência"
    }
  },
  "combinacao_sugerida": {
    "descricao": "Mix ideal para um post padrão (máx 10 hashtags)",
    "hashtags": ["lista dos 10 mais estratégicos combinando categorias"],
    "para_receitas": ["mix específico para posts de receita"],
    "para_treino": ["mix específico para posts de treino"],
    "para_motivacao": ["mix específico para posts motivacionais"]
  },
  "evitar": ["hashtags com reputação ruim ou muito saturadas"],
  "dica_do_mes": "Insight estratégico específico para ${mesAtual}"
}`;

  const text  = await gerarTexto(prompt, 3000);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('IA não retornou JSON válido');
  return JSON.parse(match[0]);
}

async function salvarESincronizar(dados) {
  if (!fs.existsSync(SCHEDULE_DIR)) fs.mkdirSync(SCHEDULE_DIR, { recursive: true });
  fs.writeFileSync(HASHTAGS_FILE, JSON.stringify(dados, null, 2));

  if (!GITHUB_TOKEN) return { local: true };

  const content = Buffer.from(JSON.stringify(dados, null, 2)).toString('base64');
  let sha;
  try {
    const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${HASHTAGS_REPO}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    })).json();
    sha = atual.sha;
  } catch { /* novo */ }

  const body = {
    message: `chore: hashtags atualizadas ${new Date().toISOString().slice(0, 10)}`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${HASHTAGS_REPO}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok };
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[agente-hashtags] Pesquisando hashtags — ${data}`);

  if (!process.env.GROQ_API_KEY && !process.env.CEREBRAS_API_KEY) {
    await enviarTelegram('⚠️ Agente Hashtags: GROQ_API_KEY/CEREBRAS_API_KEY não configuradas.');
    process.exit(1);
  }

  let dados;
  try {
    dados = await gerarHashtags();
  } catch (err) {
    await enviarTelegram(`🔴 Agente Hashtags — IA falhou: ${err.message.slice(0, 200)}`);
    throw err;
  }

  await salvarESincronizar(dados);

  const total = Object.values(dados.categorias || {}).reduce((s, c) => s + (c.hashtags?.length || 0), 0);
  const sugeridas = (dados.combinacao_sugerida?.hashtags || []).join(' ');

  await enviarTelegram(
    `#️⃣ <b>Agente Hashtags — ${data}</b>\n\n` +
    `${total} hashtags geradas por categoria:\n` +
    Object.entries(dados.categorias || {}).map(([cat, v]) =>
      `• ${cat}: ${v.hashtags?.length || 0} tags`
    ).join('\n') +
    `\n\n<b>Mix sugerido (10 tags):</b>\n${sugeridas}\n\n` +
    `💡 ${dados.dica_do_mes || ''}\n\n` +
    `✅ Salvo em schedule/hashtags-recomendadas.json`
  );

  console.log(`✅ ${total} hashtags geradas e salvas.`);
}

main().catch(err => {
  console.error('ERRO FATAL agente-hashtags:', err.message);
  process.exit(1);
});
