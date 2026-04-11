/**
 * dashboard-generator.cjs
 * Gera um dashboard HTML estático com métricas de performance do Instagram.
 * Lê todos os relatórios JSON e published-posts.json para montar as visualizações.
 *
 * Uso: node dashboard-generator.cjs
 * Saída: automation/dashboard/index.html
 */

const fs   = require('fs');
const path = require('path');

const RELATORIOS_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/Relatórios';
const REPORTS_DIR  = `${RELATORIOS_DIR}/Relatório insights instagram`;
const LOGS_DIR     = path.join(__dirname, 'logs');
const OUTPUT_DIR   = RELATORIOS_DIR;
const SCHEDULE_DIR = path.join(__dirname, 'schedule');

function loadAllReports() {
  const dirs = [REPORTS_DIR];
  const reports = [];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('relatorio-') && f.endsWith('.json'))
      .sort();
    for (const f of files) {
      try {
        reports.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')));
      } catch {}
    }
  }
  return reports;
}

function loadPublishedPosts() {
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  if (!fs.existsSync(trackingFile)) return {};
  try { return JSON.parse(fs.readFileSync(trackingFile, 'utf8')); } catch { return {}; }
}

function loadNextWeekPlan() {
  if (!fs.existsSync(SCHEDULE_DIR)) return null;
  const files = fs.readdirSync(SCHEDULE_DIR)
    .filter(f => f.endsWith('.json') && f.startsWith('week-'))
    .sort().reverse();
  if (!files.length) return null;
  try { return JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, files[0]), 'utf8')); } catch { return null; }
}

function buildDashboardHTML(reports, publishedPosts, nextPlan) {
  // Agrega todos os posts de todos os relatórios
  const allPosts = reports.flatMap(r => (r.posts || []).map(p => ({ ...p, weekEnd: r.weekEnd, weekStart: r.weekStart })));

  // Métricas gerais
  const totalPosts = allPosts.length;
  const avgScore = totalPosts > 0 ? Math.round(allPosts.reduce((s, p) => s + (p.score || 0), 0) / totalPosts) : 0;
  const totalSaved = allPosts.reduce((s, p) => s + (p.metrics?.saved || 0), 0);
  const totalReach = allPosts.reduce((s, p) => s + (p.metrics?.reach || 0), 0);

  // Por tipo de conteúdo
  const byType = {};
  for (const p of allPosts) {
    if (!byType[p.type]) byType[p.type] = { count: 0, totalScore: 0, totalSaved: 0 };
    byType[p.type].count++;
    byType[p.type].totalScore += p.score || 0;
    byType[p.type].totalSaved += p.metrics?.saved || 0;
  }
  const typeData = Object.entries(byType)
    .map(([type, d]) => ({ type, count: d.count, avgScore: Math.round(d.totalScore / d.count), totalSaved: d.totalSaved }))
    .sort((a, b) => b.avgScore - a.avgScore);

  // Top 5 posts por score
  const top5 = [...allPosts].sort((a, b) => (b.score || 0) - (a.score || 0)).slice(0, 5);

  // Posts publicados recentemente (últimos 7 dias)
  const recentDates = Object.keys(publishedPosts).sort().reverse().slice(0, 7);
  const recentRows = recentDates.flatMap(date =>
    Object.entries(publishedPosts[date]).map(([idx, p]) => ({ date, idx, ...p }))
  );

  // Próxima semana
  const nextWeekDays = nextPlan ? Object.entries(nextPlan.days || {}).slice(0, 7) : [];

  // Gráfico de score por semana
  const weeklyScores = reports.map(r => ({
    week: r.weekEnd,
    avg: r.posts?.length ? Math.round(r.posts.reduce((s, p) => s + (p.score || 0), 0) / r.posts.length) : 0
  }));

  const maxScore = Math.max(...weeklyScores.map(w => w.avg), 1);
  const chartBars = weeklyScores.map(w => {
    const pct = Math.round((w.avg / maxScore) * 100);
    return `<div class="bar-item">
      <div class="bar-fill" style="height:${pct}%"></div>
      <div class="bar-label">${(w.week || '').slice(5)}</div>
      <div class="bar-val">${w.avg}</div>
    </div>`;
  }).join('');

  // Tabela top posts
  const topRows = top5.map(p => `
    <tr>
      <td>${p.weekEnd || ''}</td>
      <td><span class="badge badge-${p.type}">${p.type}</span></td>
      <td>${(p.headline || p.title || '').slice(0, 50)}</td>
      <td class="num">${p.score || 0}</td>
      <td class="num">${p.metrics?.saved || 0}</td>
      <td class="num">${p.metrics?.reach || 0}</td>
    </tr>`).join('');

  // Tabela publicações recentes
  const recentRowsHTML = recentRows.map(r => `
    <tr>
      <td>${r.date}</td>
      <td>Post ${r.idx}</td>
      <td><span class="badge badge-${r.type || 'feed'}">${r.type || 'feed'}</span></td>
      <td><span class="badge badge-${r.format === 'carousel' ? 'carrossel' : 'single'}">${r.format === 'carousel' ? 'Carrossel' : 'Simples'}</span></td>
      <td class="mono">${(r.postId || '').slice(0, 18)}...</td>
    </tr>`).join('');

  // Próxima semana
  const nextWeekHTML = nextWeekDays.map(([date, day]) => {
    const reels = (day.reels || []).slice(0, 2).map(r => `<li>${r.headline}</li>`).join('');
    const posts = (day.posts || []).map(p => `<li class="post-item">${p.type}: ${(p.headline || p.caption || '').slice(0, 40)}</li>`).join('');
    return `<div class="week-day">
      <div class="day-header">${date}</div>
      <ul>${reels}${posts}</ul>
    </div>`;
  }).join('');

  // Tipo cards
  const typeCardsHTML = typeData.map(t => `
    <div class="metric-card">
      <div class="metric-label">${t.type}</div>
      <div class="metric-value">${t.avgScore}</div>
      <div class="metric-sub">${t.count} posts · ${t.totalSaved} salvamentos</div>
    </div>`).join('');

  const now = new Date().toLocaleString('pt-BR');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>BioNexus Digital — Dashboard @leandro_personall</title>
<style>
  :root {
    --bg: #0D1020; --surface: #161829; --card: #1E2138;
    --accent: #E8614A; --accent2: #F0A500;
    --text: #F8F6F1; --muted: rgba(248,246,241,0.55);
    --green: #4CAF50; --blue: #2196F3;
  }
  * { margin:0; padding:0; box-sizing:border-box; }
  body { background:var(--bg); color:var(--text); font-family:'Segoe UI',system-ui,sans-serif; padding:32px; }
  h1 { font-size:28px; font-weight:900; color:var(--accent); margin-bottom:4px; }
  .subtitle { font-size:14px; color:var(--muted); margin-bottom:32px; }
  h2 { font-size:18px; font-weight:700; color:var(--text); margin-bottom:16px; padding-bottom:8px; border-bottom:1px solid rgba(255,255,255,0.08); }

  /* Top metrics row */
  .metrics-row { display:grid; grid-template-columns:repeat(auto-fit,minmax(180px,1fr)); gap:16px; margin-bottom:32px; }
  .metric-card { background:var(--card); border-radius:12px; padding:20px 24px; }
  .metric-label { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:var(--muted); margin-bottom:8px; }
  .metric-value { font-size:36px; font-weight:900; color:var(--accent); }
  .metric-sub { font-size:12px; color:var(--muted); margin-top:4px; }

  /* Grid layout */
  .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:24px; margin-bottom:32px; }
  .section { background:var(--surface); border-radius:14px; padding:24px; }

  /* Bar chart */
  .bar-chart { display:flex; align-items:flex-end; gap:8px; height:120px; padding-bottom:24px; position:relative; }
  .bar-item { display:flex; flex-direction:column; align-items:center; flex:1; }
  .bar-fill { background:var(--accent); border-radius:4px 4px 0 0; width:100%; min-height:4px; transition:height 0.3s; }
  .bar-label { font-size:10px; color:var(--muted); margin-top:4px; }
  .bar-val { font-size:11px; color:var(--text); font-weight:700; }

  /* Tables */
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:1px; padding:8px 12px; border-bottom:1px solid rgba(255,255,255,0.08); }
  td { padding:10px 12px; border-bottom:1px solid rgba(255,255,255,0.05); }
  tr:last-child td { border-bottom:none; }
  .num { text-align:right; font-variant-numeric:tabular-nums; }
  .mono { font-family:monospace; font-size:11px; color:var(--muted); }

  /* Badges */
  .badge { display:inline-block; padding:2px 10px; border-radius:100px; font-size:11px; font-weight:700; }
  .badge-motivacional { background:rgba(232,97,74,0.2); color:#E8614A; }
  .badge-educativo { background:rgba(33,150,243,0.2); color:#64B5F6; }
  .badge-cientifico, .badge-científico { background:rgba(76,175,80,0.2); color:#81C784; }
  .badge-mitos { background:rgba(240,165,0,0.2); color:#F0A500; }
  .badge-treino { background:rgba(156,39,176,0.2); color:#CE93D8; }
  .badge-receita, .badge-dica_receita { background:rgba(0,188,212,0.2); color:#4DD0E1; }
  .badge-single { background:rgba(255,255,255,0.1); color:var(--muted); }
  .badge-carrossel { background:rgba(232,97,74,0.2); color:#E8614A; }
  .badge-feed { background:rgba(255,255,255,0.1); color:var(--muted); }

  /* Next week */
  .week-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(200px,1fr)); gap:12px; }
  .week-day { background:var(--card); border-radius:10px; padding:16px; }
  .day-header { font-size:12px; font-weight:700; color:var(--accent); margin-bottom:10px; }
  ul { list-style:none; }
  li { font-size:12px; color:var(--muted); padding:3px 0; padding-left:12px; position:relative; }
  li::before { content:'→'; position:absolute; left:0; color:var(--accent); }
  li.post-item::before { color:var(--blue); }

  .full-row { grid-column:1/-1; }
  .updated { font-size:11px; color:var(--muted); margin-top:24px; text-align:right; }
</style>
</head>
<body>

<h1>📊 Dashboard — @leandro_personall</h1>
<p class="subtitle">BioNexus Digital · Atualizado em ${now}</p>

<!-- Métricas gerais -->
<div class="metrics-row">
  <div class="metric-card">
    <div class="metric-label">Total de posts analisados</div>
    <div class="metric-value">${totalPosts}</div>
    <div class="metric-sub">em ${reports.length} semanas</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Score médio geral</div>
    <div class="metric-value">${avgScore}</div>
    <div class="metric-sub">de 0 a 100</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Total salvamentos</div>
    <div class="metric-value">${totalSaved}</div>
    <div class="metric-sub">em todos os períodos</div>
  </div>
  <div class="metric-card">
    <div class="metric-label">Alcance total</div>
    <div class="metric-value">${totalReach.toLocaleString('pt-BR')}</div>
    <div class="metric-sub">contas alcançadas</div>
  </div>
</div>

<!-- Score por semana + por tipo -->
<div class="grid-2">
  <div class="section">
    <h2>Evolução semanal (score médio)</h2>
    ${weeklyScores.length > 0 ? `<div class="bar-chart">${chartBars}</div>` : '<p style="color:var(--muted);font-size:13px">Sem dados suficientes ainda.</p>'}
  </div>
  <div class="section">
    <h2>Performance por tipo de conteúdo</h2>
    ${typeData.length > 0 ? `<div class="metrics-row" style="margin-bottom:0">${typeCardsHTML}</div>` : '<p style="color:var(--muted);font-size:13px">Sem dados suficientes ainda.</p>'}
  </div>
</div>

<!-- Top posts + publicações recentes -->
<div class="grid-2">
  <div class="section">
    <h2>🏆 Top 5 posts (por score)</h2>
    ${top5.length > 0 ? `
    <table>
      <thead><tr><th>Semana</th><th>Tipo</th><th>Headline</th><th class="num">Score</th><th class="num">Salvos</th><th class="num">Alcance</th></tr></thead>
      <tbody>${topRows}</tbody>
    </table>` : '<p style="color:var(--muted);font-size:13px">Sem dados de relatórios ainda.</p>'}
  </div>
  <div class="section">
    <h2>📤 Publicações recentes</h2>
    ${recentRows.length > 0 ? `
    <table>
      <thead><tr><th>Data</th><th>Post</th><th>Tipo</th><th>Formato</th><th>ID</th></tr></thead>
      <tbody>${recentRowsHTML}</tbody>
    </table>` : '<p style="color:var(--muted);font-size:13px">Nenhuma publicação rastreada ainda.</p>'}
  </div>
</div>

<!-- Próxima semana -->
${nextWeekHTML ? `
<div class="section" style="margin-bottom:32px">
  <h2>🗓 Próxima semana (plano)</h2>
  <div class="week-grid">${nextWeekHTML}</div>
</div>` : ''}

<p class="updated">Gerado automaticamente pelo BioNexus Digital · dashboard-generator.cjs</p>

</body>
</html>`;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('BioNexus Digital — Dashboard Generator');
  console.log('═══════════════════════════════════════════');

  const reports = loadAllReports();
  console.log(`Relatórios carregados: ${reports.length}`);

  const publishedPosts = loadPublishedPosts();
  const totalPublished = Object.values(publishedPosts).reduce((s, d) => s + Object.keys(d).length, 0);
  console.log(`Publicações rastreadas: ${totalPublished}`);

  const nextPlan = loadNextWeekPlan();
  console.log(`Plano próxima semana: ${nextPlan ? 'carregado' : 'não encontrado'}`);

  if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const html = buildDashboardHTML(reports, publishedPosts, nextPlan);
  const outputPath = path.join(OUTPUT_DIR, 'index.html');
  fs.writeFileSync(outputPath, html, 'utf8');

  console.log(`✅ Dashboard gerado: ${outputPath}`);
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
