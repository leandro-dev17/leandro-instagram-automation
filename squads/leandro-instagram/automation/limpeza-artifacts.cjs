#!/usr/bin/env node
'use strict';

/**
 * limpeza-artifacts.cjs — Limpeza de Artifacts Expirados do GitHub Actions
 *
 * Roda toda sexta-feira às 23:00 BRT (26:00 UTC — ajustado para 02:00 UTC sábado).
 * Deleta artifacts expirados ou muito antigos para evitar que a cota
 * de storage esgote (o que causou falha no dia 29/05/2026).
 *
 * Mantém apenas:
 * - Artifacts dos últimos 3 dias (dentro da retention-days=2 configurada)
 * - Remove qualquer artifact com > 3 dias
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

const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
const REPO          = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const DIAS_MANTER   = 3;     // Mantém artifacts dos últimos 3 dias
const LIMITE_ALERTA = 50;    // Alerta se ainda sobrar >50 artifacts após limpeza (quota em risco)

async function githubApi(endpoint, method = 'GET') {
  const res = await fetch(`https://api.github.com/repos/${REPO}${endpoint}`, {
    method,
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'BioNexus-Limpeza/1.0',
    },
  });
  if (method === 'DELETE') return { ok: res.ok, status: res.status };
  if (!res.ok) throw new Error(`GitHub API ${endpoint}: ${res.status}`);
  const text = await res.text();
  return text ? JSON.parse(text) : {};
}

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

async function listarArtifacts() {
  const todos = [];
  let page = 1;

  while (true) {
    const data = await githubApi(`/actions/artifacts?per_page=100&page=${page}`);
    const items = data.artifacts || [];
    todos.push(...items);
    if (items.length < 100) break;
    page++;
  }

  return todos;
}

async function deletarArtifact(id) {
  return githubApi(`/actions/artifacts/${id}`, 'DELETE');
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[limpeza-artifacts] Iniciando limpeza — ${data}`);

  if (!GITHUB_TOKEN) {
    await enviarTelegram('⚠️ Limpeza de Artifacts: GITHUB_TOKEN não configurado.');
    process.exit(1);
  }

  let artifacts;
  try {
    artifacts = await listarArtifacts();
  } catch (err) {
    await enviarTelegram(`🔴 Limpeza de Artifacts — erro ao listar: ${err.message.slice(0, 150)}`);
    throw err;
  }

  const corte    = new Date(Date.now() - DIAS_MANTER * 24 * 3600 * 1000);
  const aRemover = artifacts.filter(a => new Date(a.created_at) < corte || a.expired);
  const aManter  = artifacts.filter(a => new Date(a.created_at) >= corte && !a.expired);

  console.log(`Total: ${artifacts.length} | A remover: ${aRemover.length} | A manter: ${aManter.length}`);

  let removidos = 0;
  let erros     = 0;
  let bytesFree = 0;

  for (const artifact of aRemover) {
    try {
      await deletarArtifact(artifact.id);
      bytesFree += artifact.size_in_bytes || 0;
      removidos++;
      // Pequena pausa para não disparar rate limit
      await new Promise(r => setTimeout(r, 200));
    } catch {
      erros++;
    }
  }

  const mbFree = (bytesFree / (1024 * 1024)).toFixed(1);
  const icone  = aManter.length > LIMITE_ALERTA ? '🟡' : '🟢';

  const msg =
    `🧹 <b>Limpeza de Artifacts — ${data}</b>\n\n` +
    `${icone} Resultado:\n` +
    `• Total encontrados: ${artifacts.length}\n` +
    `• Removidos: ${removidos} artifacts (${mbFree} MB liberados)\n` +
    `• Mantidos: ${aManter.length} (últimos ${DIAS_MANTER} dias)\n` +
    (erros > 0 ? `• Erros: ${erros}\n` : '') +
    (aManter.length > LIMITE_ALERTA
      ? `\n⚠️ Ainda ${aManter.length} artifacts — cota pode encher. Reduza retention-days no workflow.`
      : `\n✅ Cota de storage gerenciada com sucesso.`);

  await enviarTelegram(msg);
  console.log(`✅ Limpeza concluída: ${removidos} removidos, ${aManter.length} mantidos, ${mbFree}MB liberados.`);
}

main().catch(err => {
  console.error('ERRO FATAL limpeza-artifacts:', err.message);
  process.exit(1);
});
