#!/usr/bin/env node
'use strict';

/**
 * relatorio-mensal.cjs — Relatório Mensal de Performance
 *
 * Roda no último dia de cada mês às 21:00 BRT.
 * Consolida dados do mês inteiro:
 * - Posts publicados por tipo (story, carousel, kling, reel-receita)
 * - Engajamento total (likes, comentários, salvamentos)
 * - Crescimento de seguidores no mês
 * - Top 3 posts de melhor performance
 * - Comparação com mês anterior
 * - Receitas mais publicadas no mês
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

async function igApi(endpoint) {
  const sep = endpoint.includes('?') ? '&' : '?';
  const res = await fetch(
    `https://graph.instagram.com/v21.0${endpoint}${sep}access_token=${IG_TOKEN}`,
    { signal: AbortSignal.timeout(20000) }
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

function getMesAtual() {
  const agora = new Date();
  const anoMes = `${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, '0')}`;
  const mesNome = agora.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
  return { anoMes, mesNome };
}

function carregarHistoricoLocal(arquivo) {
  try {
    if (fs.existsSync(arquivo)) return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  } catch { /* ignora */ }
  return null;
}

async function carregarHistoricoGitHub(repoPath) {
  if (!GITHUB_TOKEN) return null;
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return JSON.parse(Buffer.from(data.content, 'base64').toString('utf8'));
  } catch { return null; }
}

async function salvarRelatorio(anoMes, dados) {
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  const localPath = path.join(LOGS_DIR, `relatorio-mensal-${anoMes}.json`);
  fs.writeFileSync(localPath, JSON.stringify(dados, null, 2));

  if (!GITHUB_TOKEN) return;

  const repoPath = `squads/leandro-instagram/automation/logs/relatorio-mensal-${anoMes}.json`;
  const content  = Buffer.from(JSON.stringify(dados, null, 2)).toString('base64');

  let sha;
  try {
    const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    })).json();
    sha = atual.sha;
  } catch { /* novo */ }

  const body = {
    message: `chore: relatório mensal ${anoMes}`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

async function main() {
  const data              = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const { anoMes, mesNome } = getMesAtual();
  console.log(`[relatorio-mensal] Gerando relatório de ${mesNome}`);

  // ── Posts do mês via IG API ───────────────────────────────────────────────
  let posts = [];
  let seguidoresAtual = 0;

  try {
    const inicio = new Date();
    inicio.setDate(1);
    const fimISO    = new Date().toISOString();
    const inicioISO = inicio.toISOString();

    const mediaRes = await igApi(
      `/${IG_USER_ID}/media?fields=id,media_type,timestamp,like_count,comments_count,caption&limit=50`
    );

    posts = (mediaRes.data || []).filter(p => {
      const ts = new Date(p.timestamp);
      return ts >= inicio && ts <= new Date();
    });

    const contaRes = await igApi(`/${IG_USER_ID}?fields=followers_count`);
    seguidoresAtual = contaRes.followers_count || 0;
  } catch (err) {
    console.warn('IG API parcialmente disponível:', err.message);
  }

  // Coleta insights dos posts do mês
  const postsComInsights = [];
  for (const post of posts.slice(0, 20)) {
    let alcance = 0, salvamentos = 0;
    try {
      const ins = await igApi(`/${post.id}/insights?metric=reach,saved`);
      for (const m of (ins.data || [])) {
        if (m.name === 'reach')  alcance     = m.values?.[0]?.value || m.value || 0;
        if (m.name === 'saved')  salvamentos = m.values?.[0]?.value || m.value || 0;
      }
    } catch { /* silencioso */ }

    postsComInsights.push({
      id:          post.id,
      tipo:        post.media_type,
      data:        post.timestamp?.slice(0, 10),
      likes:       post.like_count || 0,
      comentarios: post.comments_count || 0,
      alcance,
      salvamentos,
      engajamento: (post.like_count || 0) + (post.comments_count || 0) + salvamentos,
    });
    await new Promise(r => setTimeout(r, 300));
  }

  // Agregados
  const totalPosts       = postsComInsights.length;
  const totalLikes       = postsComInsights.reduce((s, p) => s + p.likes, 0);
  const totalComents     = postsComInsights.reduce((s, p) => s + p.comentarios, 0);
  const totalSalvamentos = postsComInsights.reduce((s, p) => s + p.salvamentos, 0);
  const totalEngaj       = postsComInsights.reduce((s, p) => s + p.engajamento, 0);
  const mediaAlcance     = totalPosts > 0 ? Math.round(postsComInsights.reduce((s, p) => s + p.alcance, 0) / totalPosts) : 0;

  // Top 3 posts
  const top3 = [...postsComInsights]
    .sort((a, b) => b.engajamento - a.engajamento)
    .slice(0, 3)
    .map((p, i) => `${i + 1}. ${p.data} — ${p.likes}❤️ ${p.comentarios}💬 ${p.salvamentos}🔖`);

  // Dados do crescimento (do histórico)
  const histCrescimento = carregarHistoricoLocal(path.join(LOGS_DIR, 'crescimento-historico.json')) ||
                          await carregarHistoricoGitHub('squads/leandro-instagram/automation/logs/crescimento-historico.json');

  let crescimentoMes = '—';
  if (histCrescimento?.semanas) {
    const semanasMes = histCrescimento.semanas.filter(s => s.semana?.startsWith(anoMes));
    if (semanasMes.length >= 2) {
      const ganho = semanasMes.reduce((s, w) => s + (w.ganhoSemana || 0), 0);
      crescimentoMes = `${ganho >= 0 ? '+' : ''}${ganho} seguidores`;
    }
  }

  // Dados do backup de publicações
  const histBackup = carregarHistoricoLocal(path.join(LOGS_DIR, `historico-${anoMes}.json`)) ||
                     await carregarHistoricoGitHub(`squads/leandro-instagram/automation/logs/historico-${anoMes}.json`);

  let publicacoesOK = '—';
  let publicacoesFalha = '—';
  if (histBackup?.dias) {
    const dias     = Object.values(histBackup.dias);
    const totalOK  = dias.reduce((s, d) => s + Object.values(d.publicacoes || {}).filter(p => p.status === 'success').length, 0);
    const totalF   = dias.reduce((s, d) => s + Object.values(d.publicacoes || {}).filter(p => p.status !== 'success').length, 0);
    publicacoesOK  = String(totalOK);
    publicacoesFalha = String(totalF);
  }

  // Mês anterior para comparação
  const mesAnterior = new Date();
  mesAnterior.setMonth(mesAnterior.getMonth() - 1);
  const anoMesAnterior = `${mesAnterior.getFullYear()}-${String(mesAnterior.getMonth() + 1).padStart(2, '0')}`;
  const relAnterior = carregarHistoricoLocal(path.join(LOGS_DIR, `relatorio-mensal-${anoMesAnterior}.json`)) ||
                      await carregarHistoricoGitHub(`squads/leandro-instagram/automation/logs/relatorio-mensal-${anoMesAnterior}.json`);

  let comparacaoMes = '';
  if (relAnterior?.totalLikes && totalLikes > 0) {
    const vLikes = ((totalLikes - relAnterior.totalLikes) / relAnterior.totalLikes * 100).toFixed(1);
    const vAlcan = relAnterior.mediaAlcance > 0 ? ((mediaAlcance - relAnterior.mediaAlcance) / relAnterior.mediaAlcance * 100).toFixed(1) : '—';
    comparacaoMes =
      `\n📊 <b>vs mês anterior:</b>\n` +
      `• Likes: ${parseFloat(vLikes) >= 0 ? '+' : ''}${vLikes}%\n` +
      `• Alcance médio: ${vAlcan !== '—' ? (parseFloat(vAlcan) >= 0 ? '+' : '') + vAlcan + '%' : '—'}`;
  }

  // Salva o relatório
  const relatorio = {
    mes: mesNome, anoMes, geradoEm: new Date().toISOString(),
    totalPosts, totalLikes, totalComents, totalSalvamentos, totalEngaj,
    mediaAlcance, seguidoresAtual, crescimentoMes,
    publicacoesOK, publicacoesFalha,
    top3Posts: top3,
  };
  await salvarRelatorio(anoMes, relatorio);

  // Relatório Telegram
  const msg =
    `📋 <b>Relatório Mensal — ${mesNome}</b>\n\n` +
    `📸 <b>Publicações:</b>\n` +
    `• Posts publicados: ${totalPosts}\n` +
    (publicacoesOK !== '—' ? `• Automações OK: ${publicacoesOK} | Falhas: ${publicacoesFalha}\n` : '') +
    `\n💬 <b>Engajamento:</b>\n` +
    `• Total likes: ${totalLikes.toLocaleString('pt-BR')}\n` +
    `• Total comentários: ${totalComents.toLocaleString('pt-BR')}\n` +
    `• Total salvamentos: ${totalSalvamentos.toLocaleString('pt-BR')}\n` +
    `• Alcance médio: ${mediaAlcance.toLocaleString('pt-BR')}\n` +
    `\n👥 <b>Crescimento:</b>\n` +
    `• Seguidores atuais: ${seguidoresAtual.toLocaleString('pt-BR')}\n` +
    `• No mês: ${crescimentoMes}\n` +
    (top3.length > 0
      ? `\n🏆 <b>Top 3 posts do mês:</b>\n${top3.join('\n')}`
      : '') +
    comparacaoMes +
    `\n\n✅ Relatório salvo em logs/relatorio-mensal-${anoMes}.json`;

  await enviarTelegram(msg);
  console.log(`✅ Relatório mensal de ${mesNome} concluído.`);
}

main().catch(err => {
  console.error('ERRO FATAL relatorio-mensal:', err.message);
  process.exit(1);
});
