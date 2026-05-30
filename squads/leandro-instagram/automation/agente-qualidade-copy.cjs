#!/usr/bin/env node
'use strict';

/**
 * agente-qualidade-copy.cjs — Validação de Qualidade de Captions
 *
 * Roda logo após o weekly-planner (20:30 BRT domingo → este às 21:30 BRT).
 * Lê os captions do cronograma semanal gerado, valida com Claude e
 * regenera os que não passarem nos critérios mínimos.
 *
 * Critérios de qualidade:
 * - Tem CTA claro? (salva, comenta, marca a amiga)
 * - Tem hashtags relevantes?
 * - Tem pelo menos 80 palavras? (não muito curto)
 * - Tom alinhado com o perfil? (motivador, feminino, acessível)
 * - Não tem erros óbvios de português?
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

function getScheduleSemana() {
  if (!fs.existsSync(SCHEDULE_DIR)) return null;
  const files = fs.readdirSync(SCHEDULE_DIR)
    .filter(f => f.startsWith('week-') && f.endsWith('.json'))
    .sort()
    .reverse();

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
      // Pega semana mais recente com dias futuros
      const amanha = new Date();
      amanha.setDate(amanha.getDate() + 1);
      const amanhaStr = amanha.toISOString().slice(0, 10);
      if (data.days && Object.keys(data.days).some(d => d >= amanhaStr)) {
        return { file, data };
      }
    } catch { continue; }
  }
  return null;
}

async function validarCaption(topic, caption, tipo) {
  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client = new Anthropic({ apiKey: ANTHROPIC_KEY });

  const response = await client.messages.create({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 2000,
    messages: [{
      role: 'user',
      content: `Você é especialista em copywriting para Instagram fitness feminino.

Avalie esta caption para o @leandro_personall (personal trainer feminino):

TIPO: ${tipo}
TEMA: ${topic}
CAPTION: """
${caption}
"""

Critérios (responda TRUE/FALSE + nota 0-10 para cada):
1. tem_cta: Tem CTA claro? (salva, comenta, marca a amiga, segue)
2. tem_hashtags: Tem hashtags relevantes ao tema?
3. comprimento_ok: Tem pelo menos 60 palavras?
4. tom_motivador: Tom feminino, acessível e motivador?
5. sem_erros: Sem erros graves de português?

Se nota geral < 7 (qualquer critério FALSE): reescreva melhor.

Responda APENAS JSON:
{
  "nota_geral": 0-10,
  "aprovado": true|false,
  "criterios": {
    "tem_cta": true|false,
    "tem_hashtags": true|false,
    "comprimento_ok": true|false,
    "tom_motivador": true|false,
    "sem_erros": true|false
  },
  "problemas": ["lista de problemas encontrados"],
  "caption_melhorado": "caption reescrito SE aprovado=false, senão null"
}`,
    }],
  });

  const text  = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) throw new Error('JSON inválido do Claude');
  return JSON.parse(match[0]);
}

async function commitarScheduleAtualizado(scheduleFile, scheduleData) {
  if (!GITHUB_TOKEN) {
    fs.writeFileSync(path.join(SCHEDULE_DIR, scheduleFile), JSON.stringify(scheduleData, null, 2));
    return { local: true };
  }

  const repoPath = `squads/leandro-instagram/automation/schedule/${scheduleFile}`;
  const content  = Buffer.from(JSON.stringify(scheduleData, null, 2)).toString('base64');

  let sha;
  try {
    const atual = await (await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    })).json();
    sha = atual.sha;
  } catch { /* arquivo novo */ }

  const body = {
    message: `fix(copy): captions melhorados pela validação de qualidade ${new Date().toISOString().slice(0, 10)}`,
    content,
    committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' },
  };
  if (sha) body.sha = sha;

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${repoPath}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status };
}

async function main() {
  const data = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  console.log(`[agente-qualidade-copy] Validando captions — ${data}`);

  if (!ANTHROPIC_KEY) {
    await enviarTelegram('⚠️ Agente Qualidade Copy: ANTHROPIC_API_KEY não configurada.');
    process.exit(1);
  }

  const schedule = getScheduleSemana();
  if (!schedule) {
    console.log('Nenhum cronograma futuro encontrado para validar.');
    return;
  }

  console.log(`Validando schedule: ${schedule.file}`);

  const dias      = Object.entries(schedule.data.days || {});
  const melhorias = [];
  let totalValidados = 0;
  let totalMelhorados = 0;

  for (const [dateStr, day] of dias.sort()) {
    // Valida carousel caption
    if (day.carousel?.caption && day.carousel?.topic) {
      try {
        const resultado = await validarCaption(day.carousel.topic, day.carousel.caption, 'Carrossel');
        totalValidados++;
        if (!resultado.aprovado && resultado.caption_melhorado) {
          schedule.data.days[dateStr].carousel.caption = resultado.caption_melhorado;
          melhorias.push(`${dateStr} Carrossel: ${resultado.problemas?.slice(0, 2).join(', ')}`);
          totalMelhorados++;
        }
      } catch (err) {
        console.warn(`Erro ao validar carousel ${dateStr}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1000)); // Rate limit
    }

    // Valida kling caption
    if (day.reel_kling?.caption && day.reel_kling?.topic) {
      try {
        const resultado = await validarCaption(day.reel_kling.topic, day.reel_kling.caption, 'Kling Reel');
        totalValidados++;
        if (!resultado.aprovado && resultado.caption_melhorado) {
          schedule.data.days[dateStr].reel_kling.caption = resultado.caption_melhorado;
          melhorias.push(`${dateStr} Kling: ${resultado.problemas?.slice(0, 2).join(', ')}`);
          totalMelhorados++;
        }
      } catch (err) {
        console.warn(`Erro ao validar kling ${dateStr}: ${err.message}`);
      }
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  if (totalMelhorados > 0) {
    await commitarScheduleAtualizado(schedule.file, schedule.data);
    await enviarTelegram(
      `✍️ <b>Qualidade de Copy — ${data}</b>\n\n` +
      `✅ ${totalValidados} captions verificados\n` +
      `🔧 ${totalMelhorados} melhorados automaticamente:\n` +
      melhorias.map(m => `• ${m}`).join('\n')
    );
  } else {
    await enviarTelegram(
      `✍️ <b>Qualidade de Copy — ${data}</b>\n\n` +
      `✅ ${totalValidados} captions verificados\n` +
      `🟢 Todos aprovados! Nenhuma melhoria necessária.`
    );
  }

  console.log(`✅ Validação concluída: ${totalValidados} verificados, ${totalMelhorados} melhorados.`);
}

main().catch(err => {
  console.error('ERRO FATAL agente-qualidade-copy:', err.message);
  process.exit(1);
});
