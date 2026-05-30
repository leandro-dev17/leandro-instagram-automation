#!/usr/bin/env node
'use strict';

/**
 * refresh-token-instagram.cjs — Renovação Automática do Token Instagram
 *
 * Roda toda segunda às 08:00 BRT, antes de tudo.
 * Verifica se o token expira em < 30 dias e, se sim, renova
 * automaticamente via IG Graph API e atualiza os secrets do GitHub.
 *
 * Instagram permite renovar long-lived tokens a qualquer momento:
 * GET /refresh_access_token?grant_type=ig_refresh_token&access_token={token}
 * → retorna novo token com validade de 60 dias.
 */

const fs            = require('fs');
const path          = require('path');
const { spawnSync } = require('child_process');

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
const IG_EXPIRES  = process.env.INSTAGRAM_TOKEN_EXPIRES_AT; // YYYY-MM-DD
const BOT_TOKEN   = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID     = process.env.TELEGRAM_CHAT_ID;
const REPO        = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';

const DIAS_AVISO   = 30; // Renova se expira em < 30 dias
const VALIDADE_NOVO = 60; // Tokens renovados duram 60 dias

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

function diasAteExpirar() {
  if (!IG_EXPIRES) return null;
  const expira = new Date(IG_EXPIRES);
  return Math.ceil((expira - new Date()) / (1000 * 60 * 60 * 24));
}

async function renovarToken(tokenAtual) {
  const res = await fetch(
    `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${tokenAtual}`,
    { signal: AbortSignal.timeout(15000) }
  );
  const data = await res.json();
  if (data.error) throw new Error(`IG API: ${data.error.message}`);
  if (!data.access_token) throw new Error('Token renovado vazio na resposta da API');
  return data.access_token;
}

function atualizarSecretGitHub(nome, valor) {
  // gh CLI usa GH_TOKEN ou GITHUB_TOKEN automaticamente no Actions runner
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const env = { ...process.env };
  if (ghToken) env.GH_TOKEN = ghToken; // gh prefere GH_TOKEN

  const result = spawnSync('gh', ['secret', 'set', nome, '--repo', REPO, '--body', valor], {
    stdio: ['ignore', 'pipe', 'pipe'],
    encoding: 'utf8',
    env,
  });
  if (result.status !== 0) {
    throw new Error(`gh secret set ${nome} falhou: ${result.stderr?.trim() || 'erro desconhecido'}`);
  }
  return true;
}

function novaDataExpiracao() {
  const data = new Date();
  data.setDate(data.getDate() + VALIDADE_NOVO);
  return data.toISOString().slice(0, 10); // YYYY-MM-DD
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[refresh-token-instagram] Verificando token — ${data}`);

  if (!IG_TOKEN) {
    await enviarTelegram('🔴 Refresh Token: INSTAGRAM_ACCESS_TOKEN não configurado nos secrets.');
    process.exit(1);
  }

  const dias = diasAteExpirar();

  if (dias === null) {
    await enviarTelegram(
      `⚠️ <b>Refresh Token Instagram</b>\n\n` +
      `INSTAGRAM_TOKEN_EXPIRES_AT não definido nos secrets.\n` +
      `Adicione: <code>gh secret set INSTAGRAM_TOKEN_EXPIRES_AT --body "YYYY-MM-DD" --repo ${REPO}</code>`
    );
    return;
  }

  console.log(`Token expira em: ${dias} dias (${IG_EXPIRES})`);

  if (dias > DIAS_AVISO) {
    console.log(`✅ Token OK — ${dias} dias restantes. Renovação não necessária.`);
    return;
  }

  // Renova o token
  console.log(`⚠️ Token expira em ${dias} dias — renovando...`);
  await enviarTelegram(
    `🔄 <b>Refresh Token Instagram — renovando</b>\n\n` +
    `Token expira em ${dias} dias (${IG_EXPIRES})\n` +
    `Renovando automaticamente...`
  );

  let novoToken;
  try {
    novoToken = await renovarToken(IG_TOKEN);
  } catch (err) {
    await enviarTelegram(
      `🔴 <b>Refresh Token — ERRO na renovação</b>\n\n` +
      `${err.message}\n\n` +
      `⚠️ <b>Leandro, renove manualmente!</b>\n` +
      `1. Acesse: developers.facebook.com → seu app\n` +
      `2. Ferramentas → Graph API Explorer\n` +
      `3. Gere novo token e atualize o secret INSTAGRAM_ACCESS_TOKEN no GitHub`
    );
    throw err;
  }

  const novaExpiracao = novaDataExpiracao();

  // Atualiza os secrets no GitHub
  let secretsAtualizados = false;
  try {
    atualizarSecretGitHub('INSTAGRAM_ACCESS_TOKEN', novoToken);
    atualizarSecretGitHub('INSTAGRAM_TOKEN_EXPIRES_AT', novaExpiracao);
    secretsAtualizados = true;
    console.log(`✅ Secrets atualizados no GitHub. Nova expiração: ${novaExpiracao}`);
  } catch (err) {
    console.warn('⚠️ gh CLI falhou:', err.message, '— token renovado mas secrets não atualizados automaticamente');
  }

  await enviarTelegram(
    `✅ <b>Refresh Token Instagram — concluído</b>\n\n` +
    `Token renovado com sucesso!\n` +
    `Nova validade: ${VALIDADE_NOVO} dias (até ${novaExpiracao})\n` +
    (secretsAtualizados
      ? `🔐 Secrets do GitHub atualizados automaticamente.`
      : `⚠️ Atualize manualmente: <code>gh secret set INSTAGRAM_ACCESS_TOKEN --body "NOVO_TOKEN"</code>`)
  );
}

main().catch(async err => {
  console.error('ERRO FATAL refresh-token-instagram:', err.message);
  process.exit(1);
});
