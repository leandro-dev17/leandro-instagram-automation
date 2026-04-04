/**
 * weekly-report.cjs
 * Lê o relatório de insights da semana e envia resumo via Telegram.
 * Chamado automaticamente no domingo após o weekly-insights e weekly-planner.
 *
 * Uso: node weekly-report.cjs
 */

const fs   = require('fs');
const path = require('path');

const { notifyWeeklyReport } = require('./lib/telegram.cjs');

const REPORTS_DIR  = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/Relatório insights instagram';
const SCHEDULE_DIR = path.join(__dirname, 'schedule');

function loadLatestReport() {
  // No GitHub Actions o relatório é salvo no workspace
  const dirs = [REPORTS_DIR, path.join(__dirname, 'reports')];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const files = fs.readdirSync(dir)
      .filter(f => f.startsWith('relatorio-') && f.endsWith('.json'))
      .sort().reverse();
    if (files.length > 0) {
      return JSON.parse(fs.readFileSync(path.join(dir, files[0]), 'utf8'));
    }
  }
  return null;
}

function getNextWeekTheme() {
  try {
    const files = fs.readdirSync(SCHEDULE_DIR)
      .filter(f => f.endsWith('.json') && f.startsWith('week-'))
      .sort().reverse();
    if (!files.length) return null;
    const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, files[0]), 'utf8'));
    // Pega o tema do primeiro dia do plano
    const firstDay = Object.values(plan.days || {})[0];
    return firstDay?.reels?.[0]?.headline || null;
  } catch {
    return null;
  }
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('BioNexus Digital — Weekly Report Telegram');
  console.log('═══════════════════════════════════════════');

  const report = loadLatestReport();
  if (!report) {
    console.log('⚠ Nenhum relatório de insights encontrado. Pulando envio.');
    process.exit(0);
  }

  const nextWeekTheme = getNextWeekTheme();

  console.log(`Relatório: ${report.weekStart} → ${report.weekEnd}`);
  console.log(`Posts analisados: ${report.posts?.length || 0}`);
  console.log('Enviando para Telegram...');

  // Reconstrói summary a partir do JSON
  const posts  = report.posts || [];
  const sorted = [...posts].sort((a, b) => b.score - a.score);
  const byType = {};
  for (const p of posts) {
    if (!byType[p.type]) byType[p.type] = { avgScore: 0, totalSaved: 0, count: 0 };
    byType[p.type].avgScore  += p.score;
    byType[p.type].totalSaved += p.metrics?.saved || 0;
    byType[p.type].count++;
  }
  for (const t of Object.keys(byType)) {
    byType[t].avgScore = Math.round(byType[t].avgScore / byType[t].count);
  }

  const summary = {
    totalPosts:  posts.length,
    weekStart:   report.weekStart,
    weekEnd:     report.weekEnd,
    bestPost:    sorted[0] || null,
    byType,
    topInsight:  sorted[0] ? `Conteúdo ${sorted[0].type} performou melhor (score ${sorted[0].score})` : null
  };

  await notifyWeeklyReport(summary, nextWeekTheme);

  console.log('✅ Relatório semanal enviado ao Telegram!');
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
