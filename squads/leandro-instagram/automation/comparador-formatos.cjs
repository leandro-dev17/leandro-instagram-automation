#!/usr/bin/env node
'use strict';

/**
 * comparador-formatos.cjs — Comparador de Performance por Formato
 *
 * Roda no dia 20 de cada mês às 09:00 BRT.
 * Consulta os últimos 30 posts e compara a performance média por tipo:
 * - Story (vídeo 15s)
 * - Carrossel (7 slides)
 * - Kling Reel (vídeo com hook)
 * - Reel Receita (imagem estática convertida em vídeo)
 *
 * Se um formato estiver consistentemente 50%+ abaixo dos outros →
 * alerta o Leandro para revisar a estratégia.
 *
 * Salva em logs/comparador-formatos-YYYY-MM.json
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

const IG_TOKEN   = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const LOGS_DIR   = path.join(__dirname, 'logs');

async function igApi(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const res = await fetch(
    `https://graph.instagram.com/v21.0${endpoint}${sep}access_token=${IG_TOKEN}`,
    { signal: AbortSignal.timeout(15000) }
  );
  const data = await res.json();
  if (data.error) throw new Error(`IG API: ${data.error.message}`);
  return data;
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

// Tenta classificar o tipo de post pelo caption e media_type
function classificarTipo(post, caption) {
  if (post.media_type === 'CAROUSEL_ALBUM') return 'carousel';
  if (post.media_type === 'IMAGE') return 'reel-receita'; // imagem = reel-dica convertida
  // VIDEO: diferencia kling de story pela caption/hashtags
  if (!caption) return 'video-desconhecido';
  const lc = caption.toLowerCase();
  if (lc.includes('receita') || lc.includes('smoothie') || lc.includes('panqueca') ||
      lc.includes('frango') || lc.includes('strogonoff') || lc.includes('#receitafit')) return 'reel-receita';
  if (lc.includes('story') || caption.length < 50) return 'story';
  return 'kling'; // Assumimos kling para vídeos longos sem receita
}

async function main() {
  const data   = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const anoMes = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`;
  console.log(`[comparador-formatos] Analisando performance — ${data}`);

  if (!IG_TOKEN || !IG_USER_ID) {
    await enviarTelegram('⚠️ Comparador de Formatos: token Instagram não configurado.');
    return;
  }

  // Busca últimos 30 posts
  let posts = [];
  try {
    const res = await igApi(`/${IG_USER_ID}/media?fields=id,media_type,timestamp,like_count,comments_count,caption&limit=30`);
    posts = res.data || [];
  } catch (err) {
    await enviarTelegram(`🔴 Comparador Formatos — API falhou: ${err.message.slice(0, 150)}`);
    return;
  }

  // Coleta insights de cada post
  const porFormato = { carousel: [], kling: [], 'reel-receita': [], story: [] };

  for (const post of posts) {
    let alcance = 0, salvamentos = 0;
    try {
      const ins = await igApi(`/${post.id}/insights?metric=reach,saved`);
      for (const m of (ins.data || [])) {
        if (m.name === 'reach') alcance     = m.values?.[0]?.value || m.value || 0;
        if (m.name === 'saved') salvamentos = m.values?.[0]?.value || m.value || 0;
      }
    } catch { /* insights podem não estar disponíveis */ }

    const tipo = classificarTipo(post, post.caption);
    const dados = {
      id:          post.id,
      data:        post.timestamp?.slice(0, 10),
      likes:       post.like_count || 0,
      comentarios: post.comments_count || 0,
      alcance,
      salvamentos,
      engajamento: (post.like_count || 0) + (post.comments_count || 0) + salvamentos,
    };

    if (porFormato[tipo]) porFormato[tipo].push(dados);
    await new Promise(r => setTimeout(r, 250)); // Rate limit
  }

  // Calcula médias por formato
  const medias = {};
  for (const [tipo, items] of Object.entries(porFormato)) {
    if (items.length === 0) { medias[tipo] = null; continue; }
    medias[tipo] = {
      quantidade:       items.length,
      mediaLikes:       Math.round(items.reduce((s, p) => s + p.likes, 0) / items.length),
      mediaComentarios: Math.round(items.reduce((s, p) => s + p.comentarios, 0) / items.length),
      mediaAlcance:     Math.round(items.reduce((s, p) => s + p.alcance, 0) / items.length),
      mediaSalvamentos: Math.round(items.reduce((s, p) => s + p.salvamentos, 0) / items.length),
      mediaEngaj:       Math.round(items.reduce((s, p) => s + p.engajamento, 0) / items.length),
    };
  }

  // Detecta formatos abaixo de 50% da média geral
  const todasMediasEngaj = Object.values(medias).filter(Boolean).map(m => m.mediaEngaj);
  const mediaGeral = todasMediasEngaj.length > 0
    ? Math.round(todasMediasEngaj.reduce((s, v) => s + v, 0) / todasMediasEngaj.length)
    : 0;

  const alertas = [];
  const formatoLabels = {
    carousel:      '📋 Carrossel',
    kling:         '🎬 Kling Reel',
    'reel-receita':'🍳 Reel Receita',
    story:         '📸 Story',
  };

  // Ranking por engajamento
  const ranking = Object.entries(medias)
    .filter(([, v]) => v !== null)
    .sort(([, a], [, b]) => b.mediaEngaj - a.mediaEngaj);

  // Verifica queda acentuada
  for (const [tipo, m] of Object.entries(medias)) {
    if (!m || mediaGeral === 0) continue;
    const pctAbaixo = ((mediaGeral - m.mediaEngaj) / mediaGeral * 100);
    if (pctAbaixo > 50) {
      alertas.push(
        `${formatoLabels[tipo] || tipo} está ${Math.round(pctAbaixo)}% abaixo da média geral — revise conteúdo ou frequência`
      );
    }
  }

  // Salva resultado
  const resultado = { anoMes, geradoEm: new Date().toISOString(), mediaGeral, medias, ranking: ranking.map(([tipo]) => tipo), alertas };

  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(path.join(LOGS_DIR, `comparador-formatos-${anoMes}.json`), JSON.stringify(resultado, null, 2));

  // Salva no GitHub
  if (GITHUB_TOKEN) {
    const repoPath = `squads/leandro-instagram/automation/logs/comparador-formatos-${anoMes}.json`;
    const content  = Buffer.from(JSON.stringify(resultado, null, 2)).toString('base64');
    let sha;
    try {
      const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
      })).json();
      sha = atual.sha;
    } catch { /* novo */ }
    const body = { message: `chore: comparador formatos ${anoMes}`, content, committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' } };
    if (sha) body.sha = sha;
    await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {});
  }

  // Formata o relatório
  const linhasRanking = ranking.map(([tipo, m], i) => {
    const icone    = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `${i + 1}.`;
    const label    = formatoLabels[tipo] || tipo;
    const amostras = m?.quantidade || 0;
    const engaj    = m?.mediaEngaj || 0;
    const likes    = m?.mediaLikes || 0;
    return `${icone} ${label}: ${engaj} eng/post (❤️${likes} avg) [${amostras} posts]`;
  });

  const msg =
    `📊 <b>Comparador de Formatos — ${data}</b>\n\n` +
    `<b>Ranking por engajamento médio:</b>\n` +
    linhasRanking.join('\n') +
    `\n\nMédia geral: ${mediaGeral} eng/post` +
    (alertas.length > 0
      ? `\n\n🚨 <b>Alertas:</b>\n${alertas.map(a => `• ${a}`).join('\n')}`
      : '\n\n✅ Todos os formatos dentro do esperado.') +
    `\n\n<i>Dados baseados nos últimos 30 posts</i>`;

  await enviarTelegram(msg);
  console.log(`✅ Comparador de formatos concluído.`);
}

main().catch(err => {
  console.error('ERRO FATAL comparador-formatos:', err.message);
  process.exit(1);
});
