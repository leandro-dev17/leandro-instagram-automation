#!/usr/bin/env node
'use strict';

/**
 * monitor-engajamento.cjs — Monitor de Engajamento Instagram
 *
 * Adaptado do monitor-relatorios da Vovó Teresinha para o contexto Instagram.
 * Roda toda segunda-feira às 10:00 BRT (13:00 UTC) via GitHub Actions.
 *
 * Consulta Instagram Graph API para os últimos 12 posts e analisa:
 * - Likes, comentários, alcance, salvamentos por tipo
 * - Melhor e pior post da semana
 * - Tendência de engajamento semana a semana
 * - Alerta se engajamento cair > 30%
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
const METRICS_FILE = path.join(__dirname, 'logs', 'engajamento-historico.json');
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

function carregarHistorico() {
  try {
    if (fs.existsSync(METRICS_FILE)) return JSON.parse(fs.readFileSync(METRICS_FILE, 'utf8'));
  } catch { /* ignora */ }
  return { semanas: [] };
}

function salvarHistorico(historico) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  // Mantém apenas últimas 12 semanas
  if (historico.semanas.length > 12) historico.semanas = historico.semanas.slice(-12);
  fs.writeFileSync(METRICS_FILE, JSON.stringify(historico, null, 2));
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const semana = `semana-${new Date().toISOString().slice(0, 10)}`;
  console.log(`[monitor-engajamento] Coletando métricas — ${data}`);

  if (!IG_TOKEN || !IG_USER_ID) {
    await enviarTelegram('⚠️ Monitor de Engajamento: INSTAGRAM_ACCESS_TOKEN ou INSTAGRAM_USER_ID não configurados.');
    return;
  }

  // Busca últimos 12 posts com métricas
  let posts;
  try {
    const mediaRes = await igApi(
      `/${IG_USER_ID}/media?fields=id,media_type,timestamp,like_count,comments_count,caption&limit=12`
    );
    posts = mediaRes.data || [];
  } catch (err) {
    await enviarTelegram(`🔴 Monitor de Engajamento — erro na API Instagram:\n${err.message}`);
    return;
  }

  if (posts.length === 0) {
    await enviarTelegram('⚠️ Monitor de Engajamento: nenhum post encontrado na API Instagram.');
    return;
  }

  // Coleta insights individuais
  const postsComInsights = [];
  for (const post of posts.slice(0, 12)) {
    try {
      let insightsData;
      try {
        insightsData = await igApi(
          `/${post.id}/insights?metric=reach,saved,impressions`
        );
      } catch {
        insightsData = { data: [] }; // API pode não retornar insights para posts antigos
      }

      const insights = {};
      for (const m of (insightsData.data || [])) {
        insights[m.name] = m.values?.[0]?.value ?? m.value ?? 0;
      }

      postsComInsights.push({
        id: post.id,
        tipo: post.media_type,
        data: post.timestamp?.slice(0, 10),
        likes: post.like_count || 0,
        comentarios: post.comments_count || 0,
        alcance: insights.reach || 0,
        salvamentos: insights.saved || 0,
        impressoes: insights.impressions || 0,
      });
    } catch { /* silencioso — continua com próximo post */ }
  }

  if (postsComInsights.length === 0) {
    await enviarTelegram('⚠️ Monitor de Engajamento: não conseguiu coletar insights.');
    return;
  }

  // Calcula métricas agregadas da semana (posts dos últimos 7 dias)
  const seteDiasAtras = new Date();
  seteDiasAtras.setDate(seteDiasAtras.getDate() - 7);
  const postsSemana = postsComInsights.filter(p => p.data && new Date(p.data) >= seteDiasAtras);

  const totalPosts    = postsSemana.length || postsComInsights.length;
  const basePosts     = postsSemana.length > 0 ? postsSemana : postsComInsights.slice(0, 7);
  const totalLikes    = basePosts.reduce((s, p) => s + p.likes, 0);
  const totalComents  = basePosts.reduce((s, p) => s + p.comentarios, 0);
  const totalSalvamentos = basePosts.reduce((s, p) => s + p.salvamentos, 0);
  const mediaAlcance  = Math.round(basePosts.reduce((s, p) => s + p.alcance, 0) / basePosts.length);
  const taxaEngaj     = mediaAlcance > 0
    ? ((totalLikes + totalComents) / (mediaAlcance * basePosts.length) * 100).toFixed(2)
    : '0.00';

  // Melhor e pior post
  const melhor = [...basePosts].sort((a, b) => (b.likes + b.comentarios) - (a.likes + a.comentarios))[0];
  const pior   = [...basePosts].sort((a, b) => (a.likes + a.comentarios) - (b.likes + b.comentarios))[0];

  // Tendência vs semana anterior
  const historico = carregarHistorico();
  const semanaAnterior = historico.semanas[historico.semanas.length - 1];
  let tendenciaMsg = '';
  let alertaQueda = false;
  if (semanaAnterior) {
    const variacaoLikes = semanaAnterior.totalLikes > 0
      ? ((totalLikes - semanaAnterior.totalLikes) / semanaAnterior.totalLikes * 100).toFixed(1)
      : '0.0';
    const variacaoAlcance = semanaAnterior.mediaAlcance > 0
      ? ((mediaAlcance - semanaAnterior.mediaAlcance) / semanaAnterior.mediaAlcance * 100).toFixed(1)
      : '0.0';
    const vLikes   = parseFloat(variacaoLikes);
    const vAlcance = parseFloat(variacaoAlcance);
    const iconeLikes   = vLikes   >= 0 ? '📈' : '📉';
    const iconeAlcance = vAlcance >= 0 ? '📈' : '📉';
    tendenciaMsg = `\n${iconeLikes} Likes: ${vLikes >= 0 ? '+' : ''}${variacaoLikes}% vs semana passada\n${iconeAlcance} Alcance: ${vAlcance >= 0 ? '+' : ''}${variacaoAlcance}% vs semana passada`;
    alertaQueda = vLikes < -30 || vAlcance < -30;
  }

  // Salva semana atual no histórico
  historico.semanas.push({ semana, totalLikes, totalComents, totalSalvamentos, mediaAlcance, taxaEngaj, totalPosts });
  salvarHistorico(historico);

  // Monta relatório
  const iconeGeral = alertaQueda ? '🔴' : '🟢';
  const msg =
    `📊 <b>Monitor de Engajamento — ${data}</b>\n` +
    `${iconeGeral} Relatório semanal @leandro_personall\n\n` +
    `📌 <b>Semana em números:</b>\n` +
    `• Posts publicados: ${totalPosts}\n` +
    `• Total de likes: ${totalLikes.toLocaleString('pt-BR')}\n` +
    `• Total de comentários: ${totalComents.toLocaleString('pt-BR')}\n` +
    `• Salvamentos: ${totalSalvamentos.toLocaleString('pt-BR')}\n` +
    `• Alcance médio: ${mediaAlcance.toLocaleString('pt-BR')}\n` +
    `• Taxa de engajamento: ${taxaEngaj}%` +
    tendenciaMsg + '\n\n' +
    `🏆 <b>Melhor post (${melhor?.data}):</b>\n` +
    `${melhor?.likes} likes · ${melhor?.comentarios} comentários · alcance ${melhor?.alcance?.toLocaleString('pt-BR')}\n\n` +
    `📉 <b>Post com menor engajamento (${pior?.data}):</b>\n` +
    `${pior?.likes} likes · ${pior?.comentarios} comentários · alcance ${pior?.alcance?.toLocaleString('pt-BR')}` +
    (alertaQueda
      ? '\n\n🚨 <b>ALERTA: Queda >30% no engajamento!</b>\nRevise a estratégia de conteúdo e horários.'
      : '');

  console.log(msg.replace(/<[^>]+>/g, ''));
  await enviarTelegram(msg);
}

main().catch(err => {
  console.error('ERRO FATAL monitor-engajamento:', err.message);
  process.exit(1);
});
