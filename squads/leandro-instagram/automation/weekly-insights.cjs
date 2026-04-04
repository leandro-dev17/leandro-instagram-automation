/**
 * weekly-insights.cjs
 * Coleta métricas de performance dos posts da última semana via Instagram API.
 * Gera relatório .md + .json usados pelo weekly-planner para planejamento inteligente.
 *
 * Uso: node weekly-insights.cjs
 * Retorna: { summary, posts } via module.exports quando importado
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');
const REPORTS_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/Relatório insights instagram';
const SCHEDULE_DIR = path.join(__dirname, 'schedule');

// ─── UTILIDADES ─────────────────────────────────────────────────────────────

function loadEnv() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim()) env[k.trim()] = v.join('=').trim();
  }
  return env;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    }).on('error', reject);
  });
}

function apiGet(endpoint, token) {
  const base = token.startsWith('IGAA') ? 'graph.instagram.com' : 'graph.facebook.com';
  return httpsGet(`https://${base}/v21.0/${endpoint}&access_token=${token}`);
}

// Score de engajamento ponderado
function calcScore(metrics) {
  return Math.round(
    (metrics.reach        || 0) * 0.1 +
    (metrics.likes        || 0) * 1.0 +
    (metrics.comments     || 0) * 2.0 +
    (metrics.saved        || 0) * 3.0 +
    (metrics.shares       || 0) * 2.0
  );
}

// Tenta identificar o tipo do post pelo cronograma salvo
function identifyPostType(post, weekSchedule) {
  if (!weekSchedule) return 'desconhecido';
  const dateStr = post.timestamp.slice(0, 10);
  const dayPlan = weekSchedule.days?.[dateStr];
  if (!dayPlan) return 'desconhecido';

  // Tenta casar pela caption
  for (const p of (dayPlan.posts || [])) {
    if (post.caption && post.caption.slice(0, 50) === (p.caption || '').slice(0, 50)) {
      return p.type;
    }
  }
  return 'feed-post';
}

// ─── COLETA DE DADOS ─────────────────────────────────────────────────────────

async function getMediaList(userId, token) {
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const result = await apiGet(
    `${userId}/media?fields=id,caption,media_type,timestamp,like_count,comments_count`,
    token
  );

  if (result.status !== 200) {
    throw new Error('Erro ao buscar posts: ' + JSON.stringify(result.body));
  }

  // Filtra últimos 7 dias
  return (result.body.data || []).filter(p => p.timestamp >= sevenDaysAgo);
}

async function getMediaInsights(mediaId, token) {
  const result = await apiGet(
    `${mediaId}/insights?metric=reach,impressions,saved,shares`,
    token
  );

  if (result.status !== 200) {
    // Insights podem não estar disponíveis para todos os posts (ex: reels)
    return {};
  }

  const metrics = {};
  for (const item of (result.body.data || [])) {
    metrics[item.name] = item.values?.[0]?.value ?? item.value ?? 0;
  }
  return metrics;
}

// ─── RELATÓRIO ───────────────────────────────────────────────────────────────

function buildReport(posts, weekStart, weekEnd) {
  const sorted = [...posts].sort((a, b) => b.score - a.score);
  const medals = ['🥇', '🥈', '🥉'];

  // Resumo por tipo
  const byType = {};
  for (const p of posts) {
    const t = p.type;
    if (!byType[t]) byType[t] = { count: 0, totalReach: 0, totalSaved: 0, totalScore: 0 };
    byType[t].count++;
    byType[t].totalReach += p.metrics.reach || 0;
    byType[t].totalSaved += p.metrics.saved || 0;
    byType[t].totalScore += p.score;
  }

  const bestType = Object.entries(byType).sort((a, b) => b[1].totalScore - a[1].totalScore)[0];
  const mostSaved = Object.entries(byType).sort((a, b) => b[1].totalSaved - a[1].totalSaved)[0];

  const lines = [
    `# 📊 Relatório de Performance — ${weekStart} a ${weekEnd}`,
    ``,
    `> Gerado automaticamente pelo BioNexus Digital`,
    ``,
    `## 🏆 Ranking de Posts`,
    ``
  ];

  sorted.forEach((post, i) => {
    const medal = medals[i] || `${i + 1}º`;
    lines.push(`### ${medal} ${post.type.toUpperCase()} — Score: ${post.score}`);
    lines.push(`**Data:** ${post.timestamp.slice(0, 10)}`);
    lines.push(`**Caption:** ${(post.caption || '').slice(0, 80)}...`);
    lines.push(`| Métrica | Valor |`);
    lines.push(`|---|---|`);
    lines.push(`| Alcance | ${post.metrics.reach || 0} |`);
    lines.push(`| Impressões | ${post.metrics.impressions || 0} |`);
    lines.push(`| Curtidas | ${post.metrics.likes || 0} |`);
    lines.push(`| Comentários | ${post.metrics.comments || 0} |`);
    lines.push(`| Salvamentos | ${post.metrics.saved || 0} |`);
    lines.push(`| Compartilhamentos | ${post.metrics.shares || 0} |`);
    lines.push(``);
  });

  lines.push(`## 📈 Resumo por Tipo de Conteúdo`);
  lines.push(``);
  for (const [type, data] of Object.entries(byType)) {
    lines.push(`**${type.toUpperCase()}** — Score médio: ${Math.round(data.totalScore / data.count)} | Alcance total: ${data.totalReach} | Saves: ${data.totalSaved}`);
  }

  lines.push(``);
  lines.push(`## 💡 Insights para a próxima semana`);
  lines.push(``);
  if (bestType) lines.push(`- ✅ Tipo que mais engajou: **${bestType[0]}** — priorize mais deste conteúdo`);
  if (mostSaved) lines.push(`- 💾 Tipo mais salvo: **${mostSaved[0]}** — conteúdo educativo está ressonando`);
  if (sorted[0]) lines.push(`- 🎯 Melhor post da semana: ${sorted[0].type} de ${sorted[0].timestamp.slice(0, 10)}`);
  if (sorted[sorted.length - 1] && sorted.length > 1) lines.push(`- ⚠️ Post com menor performance: ${sorted[sorted.length - 1].type} — experimente ângulo diferente`);

  lines.push(``);
  lines.push(`*Score = reach×0.1 + likes×1 + comentários×2 + saves×3 + compartilhamentos×2*`);

  return lines.join('\n');
}

// ─── MAIN ─────────────────────────────────────────────────────────────────────

async function collectInsights() {
  const env = loadEnv();
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  const userId = env.INSTAGRAM_USER_ID;

  if (!token || !userId) throw new Error('INSTAGRAM_ACCESS_TOKEN ou INSTAGRAM_USER_ID não configurados');

  // Carrega cronograma mais recente para identificar tipos de post
  let weekSchedule = null;
  try {
    const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json')).sort().reverse();
    if (files.length > 0) {
      weekSchedule = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, files[0]), 'utf8'));
    }
  } catch {}

  console.log('Buscando posts da última semana...');
  const mediaList = await getMediaList(userId, token);
  console.log(`  ${mediaList.length} posts encontrados`);

  const posts = [];
  for (const media of mediaList) {
    if (media.media_type === 'VIDEO') continue; // Reels — sem insights detalhados

    process.stdout.write(`  → Coletando insights de ${media.id}...`);
    const insights = await getMediaInsights(media.id, token);

    const metrics = {
      reach:       insights.reach        || 0,
      impressions: insights.impressions  || 0,
      likes:       media.like_count      || 0,
      comments:    media.comments_count  || 0,
      saved:       insights.saved        || 0,
      shares:      insights.shares       || 0
    };

    posts.push({
      id: media.id,
      type: identifyPostType(media, weekSchedule),
      timestamp: media.timestamp,
      caption: media.caption || '',
      metrics,
      score: calcScore(metrics)
    });

    console.log(` score: ${calcScore(metrics)}`);
  }

  const weekStart = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const weekEnd = new Date().toISOString().slice(0, 10);

  // Salva relatório
  if (!fs.existsSync(REPORTS_DIR)) fs.mkdirSync(REPORTS_DIR, { recursive: true });

  const reportMd = buildReport(posts, weekStart, weekEnd);
  const reportJson = { weekStart, weekEnd, generatedAt: new Date().toISOString(), posts };

  const mdPath = path.join(REPORTS_DIR, `relatorio-${weekEnd}.md`);
  const jsonPath = path.join(REPORTS_DIR, `relatorio-${weekEnd}.json`);

  fs.writeFileSync(mdPath, reportMd, 'utf8');
  fs.writeFileSync(jsonPath, JSON.stringify(reportJson, null, 2), 'utf8');

  // Resumo para o planner
  const sorted = [...posts].sort((a, b) => b.score - a.score);
  const summary = {
    totalPosts: posts.length,
    weekStart,
    weekEnd,
    bestPost: sorted[0] || null,
    worstPost: sorted[sorted.length - 1] || null,
    byType: {},
    topInsight: sorted[0] ? `Conteúdo ${sorted[0].type} performou melhor (score ${sorted[0].score})` : null
  };

  for (const p of posts) {
    if (!summary.byType[p.type]) summary.byType[p.type] = { avgScore: 0, totalSaved: 0, count: 0 };
    summary.byType[p.type].avgScore += p.score;
    summary.byType[p.type].totalSaved += p.metrics.saved;
    summary.byType[p.type].count++;
  }
  for (const t of Object.keys(summary.byType)) {
    summary.byType[t].avgScore = Math.round(summary.byType[t].avgScore / summary.byType[t].count);
  }

  return { summary, posts, mdPath };
}

// Execução direta
if (require.main === module) {
  console.log('═══════════════════════════════════════════');
  console.log('BioNexus Digital Weekly Insights');
  console.log('═══════════════════════════════════════════');

  collectInsights().then(({ summary, mdPath }) => {
    console.log('');
    console.log('═══════════════════════════════════════════');
    console.log(`✅ Relatório gerado: ${mdPath}`);
    console.log(`   Posts analisados: ${summary.totalPosts}`);
    if (summary.bestPost) console.log(`   Melhor post: ${summary.bestPost.type} (score ${summary.bestPost.score})`);
    console.log('═══════════════════════════════════════════');
  }).catch(err => {
    console.error('ERRO:', err.message);
    process.exit(1);
  });
}

module.exports = { collectInsights };
