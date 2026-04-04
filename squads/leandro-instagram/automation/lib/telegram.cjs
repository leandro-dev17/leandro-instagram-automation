/**
 * telegram.cjs — Notificações via Telegram Bot
 * Envia mensagem ao usuário quando um post/reel/story é publicado.
 *
 * Setup: adicione no .env
 *   TELEGRAM_BOT_TOKEN=seu_token
 *   TELEGRAM_CHAT_ID=seu_chat_id
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

function loadTelegramConfig() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim()) env[k.trim()] = v.join('=').trim();
  }
  return {
    token: env.TELEGRAM_BOT_TOKEN || '',
    chatId: env.TELEGRAM_CHAT_ID || ''
  };
}

function sendMessage(text) {
  const { token, chatId } = loadTelegramConfig();

  if (!token || !chatId) {
    console.log('  ⚠ Telegram não configurado — pulando notificação.');
    return Promise.resolve();
  }

  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.telegram.org',
      path: `/bot${token}/sendMessage`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };
    const req = https.request(options, res => {
      res.on('data', () => {});
      res.on('end', resolve);
    });
    req.on('error', () => resolve()); // falha silenciosa — não interrompe a automação
    req.write(body);
    req.end();
  });
}

/**
 * Notifica publicação de post no feed.
 */
function notifyPost(postNumber, type, postId, dateStr) {
  const emoji = { motivacional: '💪', educativo: '📚', cientifico: '🔬' }[type] || '📱';
  const horario = { 1: '07:00', 2: '12:00', 3: '18:00' }[postNumber] || '';
  const text = [
    `${emoji} <b>Post ${postNumber} publicado!</b>`,
    ``,
    `📅 Data: ${dateStr}`,
    `🕐 Horário: ${horario}h`,
    `📌 Tipo: ${type}`,
    `🆔 Instagram ID: <code>${postId}</code>`,
    ``,
    `✅ Automação BioNexus funcionando perfeitamente!`
  ].join('\n');
  return sendMessage(text);
}

/**
 * Notifica publicação de reel.
 */
function notifyReel(reelNumber, headline, postId, dateStr) {
  const text = [
    `🎬 <b>Reel ${reelNumber} publicado!</b>`,
    ``,
    `📅 Data: ${dateStr}`,
    `📝 Headline: ${headline}`,
    `🆔 Instagram ID: <code>${postId}</code>`,
    ``,
    `✅ Automação BioNexus funcionando perfeitamente!`
  ].join('\n');
  return sendMessage(text);
}

/**
 * Notifica publicação de story.
 */
function notifyStory(storyNumber, postId, dateStr) {
  const text = [
    `📸 <b>Story ${storyNumber} publicado!</b>`,
    ``,
    `📅 Data: ${dateStr}`,
    `🆔 Instagram ID: <code>${postId}</code>`,
    ``,
    `✅ Automação BioNexus funcionando perfeitamente!`
  ].join('\n');
  return sendMessage(text);
}

/**
 * Notifica erro crítico na automação.
 */
function notifyError(script, errorMsg) {
  const text = [
    `⚠️ <b>ERRO na automação BioNexus!</b>`,
    ``,
    `📄 Script: ${script}`,
    `❌ Erro: ${errorMsg.slice(0, 300)}`,
    ``,
    `Verifique os logs em automation/logs/`
  ].join('\n');
  return sendMessage(text);
}

/**
 * Envia o relatório semanal de performance via Telegram.
 */
function notifyWeeklyReport(summary, nextWeekTheme) {
  const byType = summary.byType || {};
  const typeLines = Object.entries(byType)
    .sort((a, b) => b[1].avgScore - a[1].avgScore)
    .map(([type, data]) => `  • ${type}: score médio ${data.avgScore} | ${data.totalSaved} salvamentos`)
    .join('\n');

  const text = [
    `📊 <b>RELATÓRIO SEMANAL @leandro_personall</b>`,
    `📅 ${summary.weekStart} → ${summary.weekEnd}`,
    ``,
    `📈 <b>Performance da semana:</b>`,
    `  • Posts analisados: ${summary.totalPosts}`,
    summary.bestPost ? `  • 🏆 Melhor conteúdo: ${summary.bestPost.type} (score ${summary.bestPost.score})` : '',
    summary.topInsight ? `  • 💡 Insight: ${summary.topInsight}` : '',
    ``,
    `📌 <b>Por tipo de conteúdo:</b>`,
    typeLines || '  Sem dados suficientes',
    ``,
    nextWeekTheme ? `🗓 <b>Tema da próxima semana:</b> ${nextWeekTheme}` : '',
    ``,
    `✅ Planejamento da próxima semana gerado automaticamente!`
  ].filter(l => l !== '').join('\n');

  return sendMessage(text);
}

module.exports = { notifyPost, notifyReel, notifyStory, notifyError, notifyWeeklyReport };
