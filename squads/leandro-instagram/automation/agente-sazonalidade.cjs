#!/usr/bin/env node
'use strict';

/**
 * agente-sazonalidade.cjs — Calendário Sazonal de Conteúdo
 *
 * Roda no primeiro dia de cada mês às 07:00 BRT.
 * Claude analisa o próximo mês e gera:
 * - Datas especiais relevantes para fitness feminino
 * - Sugestões de conteúdo temático para cada data
 * - Alertas para o Leandro planejar com antecedência
 *
 * Salva em schedule/sazonalidade-YYYY-MM.json e alerta Telegram.
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

const ANTHROPIC_KEY = process.env.ANTHROPIC_API_KEY;
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
const GITHUB_TOKEN  = process.env.GITHUB_TOKEN;
const REPO          = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const SCHEDULE_DIR  = path.join(__dirname, 'schedule');

async function enviarTelegram(msg) {
  if (!BOT_TOKEN || !CHAT_ID) { console.log(msg.replace(/<[^>]+>/g, '')); return; }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: CHAT_ID, text: msg, parse_mode: 'HTML' }),
  });
}

function getProximoMes() {
  const agora     = new Date();
  const proximo   = new Date(agora.getFullYear(), agora.getMonth() + 1, 1);
  const mesNum    = proximo.getMonth() + 1;
  const anoNum    = proximo.getFullYear();
  const mesNome   = proximo.toLocaleDateString('pt-BR', { month: 'long' });
  const anoMes    = `${anoNum}-${String(mesNum).padStart(2, '0')}`;
  return { mesNum, anoNum, mesNome, anoMes };
}

async function gerarSazonalidade(mesNome, mesNum, anoNum) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 3000,
    messages: [{
      role: 'user',
      content: `Você é especialista em marketing de conteúdo fitness feminino no Brasil.

Gere o calendário sazonal para ${mesNome} de ${anoNum} para o @leandro_personall (personal trainer feminino em Jaraguá do Sul-SC).

PÚBLICO: Mulheres 25-45 anos, foco em emagrecimento, disposição, treino feminino.

Analise:
1. Datas comemorativas do mês (Dia das Mães, Dia da Mulher, etc.)
2. Eventos fitness/saúde do mês
3. Contexto sazonal (estação, férias, vestibular, etc.)
4. Oportunidades de conteúdo temático
5. Alertas de conteúdo que o Leandro deveria criar com antecedência

Responda APENAS com JSON:
{
  "mes": "${mesNome} ${anoNum}",
  "estacao": "verão|outono|inverno|primavera",
  "contexto_geral": "Resumo do contexto do mês para fitness feminino",
  "datas_especiais": [
    {
      "data": "YYYY-MM-DD",
      "nome": "Nome da data",
      "relevancia": "alta|media|baixa",
      "sugestao_conteudo": "O que criar para essa data",
      "formato_ideal": "carousel|story|reel|kling",
      "criar_com_antecedencia": "quantos dias antes criar o conteúdo"
    }
  ],
  "temas_do_mes": [
    {
      "tema": "Tema recorrente do mês",
      "descricao": "Por que é relevante esse mês",
      "frequencia_sugerida": "1x na semana|2x por semana|etc"
    }
  ],
  "alertas": [
    "Alerta importante para o Leandro planejar"
  ]
}`,
    }],
  });

  const text  = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('Claude não retornou JSON válido');
  return JSON.parse(match[0]);
}

async function salvarESincronizar(anoMes, dados) {
  if (!fs.existsSync(SCHEDULE_DIR)) fs.mkdirSync(SCHEDULE_DIR, { recursive: true });

  const localPath = path.join(SCHEDULE_DIR, `sazonalidade-${anoMes}.json`);
  fs.writeFileSync(localPath, JSON.stringify(dados, null, 2));

  if (!GITHUB_TOKEN) return { local: true };

  const repoPath = `squads/leandro-instagram/automation/schedule/sazonalidade-${anoMes}.json`;
  const content  = Buffer.from(JSON.stringify(dados, null, 2)).toString('base64');

  let sha;
  try {
    const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    })).json();
    sha = atual.sha;
  } catch { /* novo */ }

  const body = {
    message: `chore: sazonalidade ${anoMes}`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok };
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[agente-sazonalidade] Gerando calendário sazonal — ${data}`);

  if (!ANTHROPIC_KEY) {
    await enviarTelegram('⚠️ Agente Sazonalidade: ANTHROPIC_API_KEY não configurada.');
    process.exit(1);
  }

  const { mesNum, anoNum, mesNome, anoMes } = getProximoMes();

  let dados;
  try {
    dados = await gerarSazonalidade(mesNome, mesNum, anoNum);
  } catch (err) {
    await enviarTelegram(`🔴 Agente Sazonalidade — Claude falhou: ${err.message.slice(0, 200)}`);
    throw err;
  }

  await salvarESincronizar(anoMes, dados);

  // Formata as datas especiais de alta relevância
  const datasAlta = (dados.datas_especiais || [])
    .filter(d => d.relevancia === 'alta')
    .map(d => `📅 ${d.data.slice(5)} — ${d.nome}: ${d.sugestao_conteudo?.slice(0, 60)}`)
    .join('\n');

  const alertas = (dados.alertas || []).map(a => `⚠️ ${a}`).join('\n');

  await enviarTelegram(
    `📅 <b>Sazonalidade — ${mesNome} ${anoNum}</b>\n\n` +
    `<b>Contexto:</b> ${dados.contexto_geral?.slice(0, 200)}\n\n` +
    (datasAlta ? `<b>Datas de alta relevância:</b>\n${datasAlta}\n\n` : '') +
    (alertas ? `<b>Alertas para o Leandro:</b>\n${alertas}` : '✅ Nenhum alerta especial esse mês.')
  );

  console.log(`✅ Calendário sazonal de ${mesNome}/${anoNum} gerado (${dados.datas_especiais?.length || 0} datas).`);
}

main().catch(err => {
  console.error('ERRO FATAL agente-sazonalidade:', err.message);
  process.exit(1);
});
