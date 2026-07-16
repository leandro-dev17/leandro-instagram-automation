#!/usr/bin/env node
'use strict';

/**
 * agente-trending.cjs — Temas em Alta para Fitness Feminino
 *
 * Roda sábado às 17:00 BRT, ANTES do weekly-planner (20:30 BRT).
 * IA (Groq→Cerebras) analisa a data, época do ano e tendências do nicho e gera
 * 10 sugestões de temas em alta para a semana seguinte.
 *
 * Salva em schedule/trending-topics.json — o weekly-planner usa como
 * referência para gerar conteúdo mais relevante e atual.
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

const { gerarTexto }  = require('./lib/ai-helper.cjs');

const BOT_TOKEN       = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID         = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN    = process.env.GITHUB_TOKEN;
const REPO            = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const SCHEDULE_DIR    = path.join(__dirname, 'schedule');
const TRENDING_FILE   = path.join(SCHEDULE_DIR, 'trending-topics.json');
const TRENDING_REPO   = 'squads/leandro-instagram/automation/schedule/trending-topics.json';

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

function getContextoEpoca() {
  const agora  = new Date();
  const mes    = agora.getMonth() + 1; // 1-12
  const dia    = agora.getDate();
  const semana = Math.ceil(dia / 7);

  const estacoes = {
    verão:   [12, 1, 2],
    outono:  [3, 4, 5],
    inverno: [6, 7, 8],
    primavera: [9, 10, 11],
  };

  const estacao = Object.entries(estacoes).find(([, meses]) => meses.includes(mes))?.[0] || 'outono';

  const datasFestivas = {
    1:  ['Ano Novo — resolução fitness', 'Verão — shape praia'],
    2:  ['Carnaval — corpo pré-carnaval', 'Verão ainda ativo'],
    3:  ['Dia da Mulher (8/3)', 'Semana Santa se aplicável', 'Verão acabando — manutenção'],
    4:  ['Outono começa — adaptação treino', 'Páscoa — receitas fit', 'Pós-festas'],
    5:  ['Dia das Mães (2º domingo)', 'Inverno chegando — bulking fit'],
    6:  ['Festa Junina — versões fit', 'Inverno — imunidade e aquecimento'],
    7:  ['Férias escolares — treino em casa', 'Meio do ano — revisão de metas'],
    8:  ['Dia dos Pais (2º domingo)', 'Inverno finalizando'],
    9:  ['Primavera — renovação e emagrecimento', 'Setembro Amarelo'],
    10: ['Outubro Rosa — saúde feminina', 'Dia das Crianças'],
    11: ['Chegando o verão — shape intensivo', 'Black Friday fitness'],
    12: ['Réveillon — shape final do ano', 'Natal — receitas fit', 'Festas — moderação'],
  };

  return { mes, dia, estacao, festas: datasFestivas[mes] || [] };
}

async function gerarTrendingTopics() {
  const ctx        = getContextoEpoca();
  const proxSemana = new Date();
  proxSemana.setDate(proxSemana.getDate() + 7);
  const semanaStr  = proxSemana.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

  const prompt = `Você é especialista em tendências de conteúdo fitness feminino no Instagram Brasil.

CONTEXTO ATUAL:
- Data: ${new Date().toLocaleDateString('pt-BR')}
- Estação: ${ctx.estacao}
- Mês: ${ctx.mes} — Datas especiais: ${ctx.festas.join(', ') || 'nenhuma específica'}
- Semana planejada: ${semanaStr}
- Perfil: @leandro_personall — personal trainer feminino em Jaraguá do Sul-SC
- Público: mulheres 25-45 anos querendo emagrecer, ganhar disposição, treinar com consistência

INSTRUÇÃO: Gere 10 temas em alta para a semana seguinte, priorizando:
1. Temas sazonais e datas especiais do mês
2. Assuntos que geram FOMO e urgência (transformação, resultados visíveis)
3. Dores reais do público feminino nessa época do ano
4. Tópicos com potencial viral no Reels (curiosidade, choque, identificação)

Para cada tema: tipo de conteúdo mais adequado (story/carousel/reel/kling).

Responda APENAS com JSON:
{
  "semana": "${new Date().toISOString().slice(0,10)}",
  "estacao": "${ctx.estacao}",
  "datas_especiais": ${JSON.stringify(ctx.festas)},
  "temas": [
    {
      "rank": 1,
      "tema": "Título do tema",
      "angulo": "Por que é relevante agora + como abordar",
      "formato_ideal": "carousel|story|reel|kling",
      "urgencia": "alta|media|baixa",
      "hook_sugerido": "Frase de abertura impactante para o conteúdo"
    }
  ]
}`;

  const text  = await gerarTexto(prompt, 3000);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('IA não retornou JSON válido');
  return JSON.parse(match[0]);
}

async function salvarTrending(topics) {
  // Salva local
  if (!fs.existsSync(SCHEDULE_DIR)) fs.mkdirSync(SCHEDULE_DIR, { recursive: true });
  fs.writeFileSync(TRENDING_FILE, JSON.stringify(topics, null, 2));

  if (!GITHUB_TOKEN) return { local: true };

  // Commit no GitHub
  const content = Buffer.from(JSON.stringify(topics, null, 2)).toString('base64');
  let sha;
  try {
    const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDING_REPO}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    })).json();
    sha = atual.sha;
  } catch { /* arquivo novo */ }

  const body = {
    message: `chore: trending topics ${new Date().toISOString().slice(0, 10)}`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${TRENDING_REPO}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[agente-trending] Gerando temas em alta — ${data}`);

  if (!process.env.GROQ_API_KEY && !process.env.CEREBRAS_API_KEY) {
    await enviarTelegram('⚠️ Agente Trending: GROQ_API_KEY/CEREBRAS_API_KEY não configuradas.');
    process.exit(1);
  }

  let topics;
  try {
    topics = await gerarTrendingTopics();
  } catch (err) {
    await enviarTelegram(`🔴 Agente Trending — IA falhou: ${err.message.slice(0, 200)}`);
    throw err;
  }

  await salvarTrending(topics);

  const top3 = (topics.temas || []).slice(0, 3).map((t, i) => `${i+1}. ${t.tema} (${t.formato_ideal})`).join('\n');

  await enviarTelegram(
    `📈 <b>Agente Trending — ${data}</b>\n\n` +
    `${topics.temas?.length || 0} temas para a semana gerados:\n\n` +
    `<b>Top 3:</b>\n${top3}\n\n` +
    `✅ Weekly-planner vai usar esses temas às 20:30 BRT`
  );

  console.log(`✅ ${topics.temas?.length} temas gerados e salvos.`);
}

main().catch(err => {
  console.error('ERRO FATAL agente-trending:', err.message);
  process.exit(1);
});
