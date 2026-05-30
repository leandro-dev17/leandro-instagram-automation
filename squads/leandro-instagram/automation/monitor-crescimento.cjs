#!/usr/bin/env node
'use strict';

/**
 * monitor-crescimento.cjs — Monitor de Crescimento da Conta Instagram
 *
 * Roda toda segunda-feira às 11:00 BRT via GitHub Actions.
 * Consulta a Instagram Graph API para métricas de crescimento da conta:
 * - Seguidores totais e variação semana a semana
 * - Alcance de stories (audience_city_top, audience_country_top)
 * - Impressões totais da semana
 * - Posts publicados
 * - Alerta se houver queda anormal (>5% em seguidores)
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

const IG_TOKEN    = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID  = process.env.INSTAGRAM_USER_ID;
const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID     = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const REPO         = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const LOGS_DIR     = path.join(__dirname, 'logs');
const HISTORICO_FILE = path.join(LOGS_DIR, 'crescimento-historico.json');
const HISTORICO_REPO = 'squads/leandro-instagram/automation/logs/crescimento-historico.json';

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
    if (fs.existsSync(HISTORICO_FILE)) return JSON.parse(fs.readFileSync(HISTORICO_FILE, 'utf8'));
  } catch { /* ignora */ }
  return { semanas: [] };
}

async function salvarHistorico(historico) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(HISTORICO_FILE, JSON.stringify(historico, null, 2));

  if (!GITHUB_TOKEN) return;

  const content = Buffer.from(JSON.stringify(historico, null, 2)).toString('base64');
  let sha;
  try {
    const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${HISTORICO_REPO}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    })).json();
    sha = atual.sha;
  } catch { /* novo */ }

  const body = {
    message: `chore: crescimento histórico ${new Date().toISOString().slice(0, 10)}`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  await fetch(`https://api.github.com/repos/${REPO}/contents/${HISTORICO_REPO}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  const data    = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const semana  = new Date().toISOString().slice(0, 10);
  console.log(`[monitor-crescimento] Coletando dados de crescimento — ${data}`);

  if (!IG_TOKEN || !IG_USER_ID) {
    await enviarTelegram('⚠️ Monitor de Crescimento: token Instagram não configurado.');
    return;
  }

  // Dados da conta
  let seguidores = 0;
  let mediaCount = 0;
  let username   = '@leandro_personall';

  try {
    const conta = await igApi(`/${IG_USER_ID}?fields=followers_count,media_count,username`);
    seguidores  = conta.followers_count || 0;
    mediaCount  = conta.media_count     || 0;
    username    = '@' + (conta.username || 'leandro_personall');
  } catch (err) {
    await enviarTelegram(`🔴 Monitor Crescimento — API Instagram falhou: ${err.message.slice(0, 150)}`);
    return;
  }

  // Insights da conta (últimos 7 dias)
  let alcanceSemana = 0;
  let impressoesSemana = 0;
  let visitas = 0;

  try {
    const insights = await igApi(
      `/${IG_USER_ID}/insights?metric=reach,impressions,profile_views&period=week`
    );
    for (const m of (insights.data || [])) {
      const val = m.values?.[m.values.length - 1]?.value || m.value || 0;
      if (m.name === 'reach')         alcanceSemana    = val;
      if (m.name === 'impressions')   impressoesSemana = val;
      if (m.name === 'profile_views') visitas          = val;
    }
  } catch { /* Insights podem não estar disponíveis em todas as contas */ }

  // Histórico e tendência
  const historico = carregarHistorico();
  const semanaAnterior = historico.semanas[historico.semanas.length - 1];

  let ganhoSemana = 0;
  let variacaoPct = '—';
  let alertaQueda = false;

  if (semanaAnterior?.seguidores) {
    ganhoSemana = seguidores - semanaAnterior.seguidores;
    const pct   = ((ganhoSemana / semanaAnterior.seguidores) * 100).toFixed(2);
    variacaoPct = `${ganhoSemana >= 0 ? '+' : ''}${pct}%`;
    alertaQueda = ganhoSemana < 0 && Math.abs(ganhoSemana / semanaAnterior.seguidores) > 0.05;
  }

  // Salva semana atual
  historico.semanas.push({ semana, seguidores, alcanceSemana, impressoesSemana, visitas, ganhoSemana });
  if (historico.semanas.length > 26) historico.semanas = historico.semanas.slice(-26); // 6 meses
  await salvarHistorico(historico);

  // Histórico formatado (últimas 4 semanas)
  const linhasHistorico = historico.semanas.slice(-4).reverse().map((s, i) => {
    const ganho = s.ganhoSemana >= 0 ? `+${s.ganhoSemana}` : `${s.ganhoSemana}`;
    return `${i === 0 ? '📍' : '  '} ${s.semana}: ${s.seguidores?.toLocaleString('pt-BR')} seguidores (${ganho})`;
  }).join('\n');

  const iconeGeral = alertaQueda ? '🔴' : ganhoSemana > 0 ? '🟢' : '🟡';

  const msg =
    `📊 <b>Monitor de Crescimento — ${data}</b>\n` +
    `${iconeGeral} ${username}\n\n` +
    `👥 <b>Seguidores:</b> ${seguidores.toLocaleString('pt-BR')} (${variacaoPct} na semana)\n` +
    `📸 <b>Posts totais:</b> ${mediaCount}\n` +
    (alcanceSemana > 0 ? `🌍 <b>Alcance semanal:</b> ${alcanceSemana.toLocaleString('pt-BR')}\n` : '') +
    (impressoesSemana > 0 ? `👁 <b>Impressões:</b> ${impressoesSemana.toLocaleString('pt-BR')}\n` : '') +
    (visitas > 0 ? `🔍 <b>Visitas ao perfil:</b> ${visitas.toLocaleString('pt-BR')}\n` : '') +
    `\n📈 <b>Últimas 4 semanas:</b>\n${linhasHistorico}` +
    (alertaQueda
      ? `\n\n🚨 <b>ALERTA: Queda de seguidores >5%!</b>\nRevise a estratégia de conteúdo e frequência.`
      : '');

  await enviarTelegram(msg);
  console.log(`✅ Monitor de crescimento concluído — ${seguidores} seguidores (${variacaoPct})`);
}

main().catch(err => {
  console.error('ERRO FATAL monitor-crescimento:', err.message);
  process.exit(1);
});
