#!/usr/bin/env node
'use strict';

/**
 * gerador-receitas-backup.cjs — Gera novas receitas fit quando o estoque cai
 *
 * Roda toda segunda-feira após o monitor de engajamento.
 * Se disponíveis < LIMITE_MINIMO → IA (Groq→Cerebras) gera 20 novas receitas no
 * mesmo formato dos batch files e commita um novo batch no repositório.
 *
 * Formato de receita (igual batch-01.json a batch-10.json):
 * { id, title, headline, category, ingredients_display[], caption, hashtags, image_prompt }
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

const BOT_TOKEN      = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID        = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
const REPO           = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const RECIPES_DIR    = path.join(__dirname, 'recipes');
const TRACKER_FILE   = path.join(RECIPES_DIR, 'recipe-tracker.json');
const LIMITE_MINIMO  = 30;   // Gera quando disponíveis < 30
const GERAR_QTDE     = 20;   // Quantas receitas gerar por ciclo

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

function carregarEstoque() {
  const tracker = JSON.parse(fs.readFileSync(TRACKER_FILE, 'utf8'));
  const usedSet = new Set(tracker.used || []);
  let allIds = [];
  fs.readdirSync(RECIPES_DIR).filter(f => f.startsWith('batch') && f.endsWith('.json')).sort().forEach(f => {
    const items = JSON.parse(fs.readFileSync(path.join(RECIPES_DIR, f), 'utf8'));
    allIds.push(...items.map(r => r.id));
  });
  const available = allIds.filter(id => !usedSet.has(id));
  return { total: allIds.length, used: usedSet.size, available: available.length };
}

function proximoBatchNum() {
  const files = fs.readdirSync(RECIPES_DIR).filter(f => /^batch-\d+\.json$/.test(f));
  const nums = files.map(f => parseInt(f.match(/\d+/)[0]));
  return Math.max(0, ...nums) + 1;
}

async function gerarReceitas(qtde, categoriasExistentes) {
  const prompt = `Você é especialista em nutrição fitness para mulheres. Gere ${qtde} receitas fit NOVAS e ÚNICAS para o Instagram @leandro_personall (personal trainer feminino).

CATEGORIAS DISPONÍVEIS: pré-treino, pós-treino, café da manhã, manhã, almoço, jantar, lanche, sobremesa, hidratação, especial

REGRAS:
- Receitas simples (máx 5 ingredientes principais)
- Ingredientes acessíveis no Brasil
- Foco em proteína, emagrecimento, energia feminina
- IDs únicos em kebab-case (ex: "mousse-maracuja-proteico")
- Caption com tom próximo e motivador, CTA, hashtags específicas
- image_prompt em inglês, detalhado para geração de imagem profissional de food photography

Responda APENAS com JSON válido — array de ${qtde} receitas:
[
  {
    "id": "nome-unico-kebab-case",
    "title": "Título Completo da Receita",
    "headline": "Título\\nPara Reel",
    "category": "categoria",
    "ingredients_display": ["✅ ingrediente 1", "✅ ingrediente 2", "✅ ingrediente 3", "✅ ingrediente 4", "✅ ingrediente 5"],
    "caption": "Legenda completa com emoji, modo de preparo resumido, benefícios, CTA e hashtags",
    "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5 #leandropersonall",
    "image_prompt": "Professional food photography, [descrição detalhada da receita], [estilo visual], hyperrealistic, 8K UHD, food styling, no text, no watermark, no people"
  }
]`;

  const text  = await gerarTexto(prompt, 8000);
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) throw new Error('IA não retornou JSON válido');
  return JSON.parse(match[0]);
}

async function commitarBatch(batchNum, receitas) {
  if (!GITHUB_TOKEN) {
    // Fallback: salva localmente
    const filePath = path.join(RECIPES_DIR, `batch-${String(batchNum).padStart(2, '0')}.json`);
    fs.writeFileSync(filePath, JSON.stringify(receitas, null, 2));
    return { local: true, path: filePath };
  }

  const filePath  = `squads/leandro-instagram/automation/recipes/batch-${String(batchNum).padStart(2, '0')}.json`;
  const content   = Buffer.from(JSON.stringify(receitas, null, 2)).toString('base64');

  let sha;
  try {
    const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    })).json();
    sha = atual.sha;
  } catch { /* arquivo novo */ }

  const body = {
    message: `chore: batch-${String(batchNum).padStart(2, '0')} — ${receitas.length} novas receitas fit geradas automaticamente`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${filePath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[gerador-receitas-backup] Verificando estoque — ${data}`);

  const estoque = carregarEstoque();
  console.log(`Estoque: ${estoque.available} disponíveis / ${estoque.total} total (${estoque.used} usadas)`);

  if (estoque.available >= LIMITE_MINIMO) {
    console.log(`✅ Estoque OK (${estoque.available} >= ${LIMITE_MINIMO}). Nenhuma geração necessária.`);
    return;
  }

  if (!process.env.GROQ_API_KEY && !process.env.CEREBRAS_API_KEY) {
    await enviarTelegram(`🔴 Gerador de Receitas: GROQ_API_KEY/CEREBRAS_API_KEY não configuradas. Estoque: ${estoque.available} receitas!`);
    return;
  }

  console.log(`⚠️ Estoque baixo (${estoque.available} < ${LIMITE_MINIMO}). Gerando ${GERAR_QTDE} novas receitas...`);

  await enviarTelegram(
    `🍳 <b>Gerador de Receitas — gerando backup</b>\n\n` +
    `Estoque baixo: ${estoque.available} disponíveis\n` +
    `Gerando ${GERAR_QTDE} novas receitas com IA...`
  );

  let novasReceitas;
  try {
    novasReceitas = await gerarReceitas(GERAR_QTDE, []);
  } catch (err) {
    await enviarTelegram(`🔴 Gerador de Receitas — IA falhou: ${err.message.slice(0, 200)}`);
    throw err;
  }

  const batchNum  = proximoBatchNum();
  const resultado = await commitarBatch(batchNum, novasReceitas);

  await enviarTelegram(
    `✅ <b>Gerador de Receitas — concluído</b>\n\n` +
    `${novasReceitas.length} novas receitas geradas\n` +
    `Arquivo: batch-${String(batchNum).padStart(2, '0')}.json\n` +
    `Estoque após: ${estoque.available + novasReceitas.length} disponíveis\n` +
    (resultado.local ? `💾 Salvo localmente (sem GitHub Token)` : `✅ Commitado no repositório`)
  );

  console.log(`✅ ${novasReceitas.length} receitas geradas e commitadas.`);
}

main().catch(err => {
  console.error('ERRO FATAL gerador-receitas-backup:', err.message);
  process.exit(1);
});
