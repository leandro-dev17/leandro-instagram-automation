#!/usr/bin/env node
'use strict';

/**
 * fiscal-token.cjs — Agente Fiscal de Token Instagram (@leandro_personall)
 *
 * Adaptado do fiscal-erros-api + guardiao-seguranca da Vovó Teresinha.
 * Roda toda segunda-feira às 09:00 UTC (06:00 BRT) via GitHub Actions.
 *
 * Monitora:
 * 1. Validade do token Instagram (alerta 15 e 7 dias antes do vencimento)
 * 2. Status do YouTube refresh token
 * 3. Chaves de API críticas configuradas
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

const BOT_TOKEN  = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID    = process.env.TELEGRAM_CHAT_ID;
const IG_TOKEN   = process.env.INSTAGRAM_ACCESS_TOKEN;
const IG_USER_ID = process.env.INSTAGRAM_USER_ID;
const YT_REFRESH = process.env.YOUTUBE_REFRESH_TOKEN;
const IG_EXPIRES = process.env.INSTAGRAM_TOKEN_EXPIRES_AT; // ex: "2026-07-15"

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

// Verifica o token com a API do Instagram Graph
async function verificarTokenInstagram() {
  if (!IG_TOKEN || !IG_USER_ID) return { ok: false, motivo: 'Token não configurado' };
  try {
    const res = await fetch(
      `https://graph.instagram.com/v21.0/${IG_USER_ID}?fields=id,username&access_token=${IG_TOKEN}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    if (data.error) return { ok: false, motivo: `API Error: ${data.error.message}` };
    return { ok: true, username: data.username };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
}

// Calcula dias restantes até expiração
function diasAteExpirar(dataStr) {
  if (!dataStr) return null;
  const expira = new Date(dataStr);
  const hoje   = new Date();
  return Math.ceil((expira - hoje) / (1000 * 60 * 60 * 24));
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[fiscal-token] Verificando tokens — ${data}`);

  const alertas   = [];
  const relatorio = [];

  // ── Instagram Token ──────────────────────────────────────────────────────
  const igStatus = await verificarTokenInstagram();
  if (igStatus.ok) {
    relatorio.push(`✅ Instagram: @${igStatus.username || 'leandro_personall'} — token ativo`);
  } else {
    alertas.push(`🔴 Instagram token INVÁLIDO: ${igStatus.motivo}`);
    relatorio.push(`❌ Instagram: token com problema — ${igStatus.motivo}`);
  }

  // Verifica data de expiração configurada
  const diasRestantes = diasAteExpirar(IG_EXPIRES);
  if (diasRestantes !== null) {
    if (diasRestantes <= 0) {
      alertas.push(`🔴 Token Instagram EXPIRADO (${IG_EXPIRES})`);
    } else if (diasRestantes <= 7) {
      alertas.push(`🚨 Token Instagram vence em ${diasRestantes} dias! Renove AGORA.`);
      relatorio.push(`⚠️ Token expira em: ${diasRestantes} dias (${IG_EXPIRES})`);
    } else if (diasRestantes <= 15) {
      alertas.push(`🟡 Token Instagram vence em ${diasRestantes} dias — planeje renovação.`);
      relatorio.push(`⚠️ Token expira em: ${diasRestantes} dias (${IG_EXPIRES})`);
    } else {
      relatorio.push(`✅ Token expira em: ${diasRestantes} dias (${IG_EXPIRES})`);
    }
  } else {
    relatorio.push(`ℹ️ Data de expiração não configurada — adicione INSTAGRAM_TOKEN_EXPIRES_AT no .env`);
  }

  // ── YouTube Token ────────────────────────────────────────────────────────
  if (YT_REFRESH) {
    relatorio.push(`✅ YouTube: refresh token configurado`);
  } else {
    relatorio.push(`⏭️ YouTube: refresh token não configurado (YouTube Shorts desabilitado)`);
  }

  // ── Variáveis de ambiente críticas ──────────────────────────────────────
  const variaveisObrigatorias = [
    'INSTAGRAM_ACCESS_TOKEN',
    'INSTAGRAM_USER_ID',
    'CLOUDINARY_CLOUD_NAME',
    'CLOUDINARY_API_KEY',
    'CLOUDINARY_API_SECRET',
    'TELEGRAM_BOT_TOKEN',
    'TELEGRAM_CHAT_ID',
  ];
  const variaveisIA = ['GROQ_API_KEY', 'CEREBRAS_API_KEY'];

  const faltando = variaveisObrigatorias.filter(v => !process.env[v]);
  if (faltando.length > 0) {
    alertas.push(`🔴 Variáveis de ambiente faltando: ${faltando.join(', ')}`);
    relatorio.push(`❌ Env vars faltando: ${faltando.join(', ')}`);
  } else {
    relatorio.push(`✅ Todas as variáveis de ambiente críticas configuradas`);
  }

  // GROQ_API_KEY/CEREBRAS_API_KEY: pelo menos uma precisa estar presente (cascata Groq→Cerebras)
  if (!variaveisIA.some(v => process.env[v])) {
    alertas.push(`🔴 Nenhuma chave de IA configurada (GROQ_API_KEY/CEREBRAS_API_KEY) — geração de texto indisponível`);
    relatorio.push(`❌ IA: nenhuma chave configurada`);
  } else {
    relatorio.push(`✅ IA: ${variaveisIA.filter(v => process.env[v]).join(', ')} configurada(s)`);
  }

  // ── Monta mensagem ───────────────────────────────────────────────────────
  const iconeGeral = alertas.length === 0 ? '🟢' : alertas.some(a => a.startsWith('🔴')) ? '🔴' : '🟡';

  const msg =
    `🔐 <b>Fiscal de Token — ${data}</b>\n` +
    `${iconeGeral} Status semanal dos tokens\n\n` +
    relatorio.join('\n') +
    (alertas.length > 0
      ? '\n\n🚨 <b>ALERTAS:</b>\n' + alertas.join('\n')
      : '\n\n✅ Tudo em ordem — nenhuma ação necessária.') +
    (diasRestantes !== null && diasRestantes <= 15
      ? '\n\n📋 <b>Como renovar o token Instagram:</b>\n' +
        '1. Acesse: facebook.com/developers → seu app\n' +
        '2. Ferramentas → Explorador de API do Graph\n' +
        '3. Gere um novo token de longa duração\n' +
        '4. Atualize INSTAGRAM_ACCESS_TOKEN nos secrets do GitHub\n' +
        '5. Atualize INSTAGRAM_TOKEN_EXPIRES_AT (válido por 60 dias)'
      : '');

  console.log(msg.replace(/<[^>]+>/g, ''));
  await enviarTelegram(msg);
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-token:', err.message);
  process.exit(1);
});
