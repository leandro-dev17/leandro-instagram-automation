#!/usr/bin/env node
'use strict';

/**
 * fiscal-temas-repetidos.cjs — Fiscal de Repetição de Temas de Conteúdo
 *
 * Roda diariamente às 09:00 BRT (12:00 UTC).
 * O weekly-planner gera temas sem saber o que foi abordado nas últimas semanas.
 * Detecta quando o mesmo assunto aparece em < 14 dias no mesmo formato.
 *
 * Salva temas já usados em schedule/temas-usados.json
 * para o planner e o agente-trending consultarem.
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
const REPO          = process.env.GITHUB_REPOSITORY || 'leandro-dev17/leandro-instagram-automation';
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID       = process.env.TELEGRAM_CHAT_ID;
const SCHEDULE_DIR  = path.join(__dirname, 'schedule');
const TEMAS_FILE    = path.join(SCHEDULE_DIR, 'temas-usados.json');
const TEMAS_REPO    = 'squads/leandro-instagram/automation/schedule/temas-usados.json';
const DIAS_JANELA   = 7;  // dias mínimos entre o mesmo tema (era 14 — muito sensível)

// Palavras-chave de comparação (normaliza temas para detectar similaridade)
const KEYWORDS = [
  'glúteo','gluteo','bumbum','perna','panturrilha','coxa',
  'metabolismo','emagrecimento','emagrecer','gordura','déficit',
  'proteína','proteina','carboidrato','alimentação','nutrição',
  'treino pesado','força','músculo','musculo',
  'ciclo','fase','menstrual','hormônio','hormonio',
  'mindset','motivação','consistência','hábito',
  'cardio','caminhada','corrida','aeróbico',
  'ombro','braço','biceps','triceps','superior',
  'abdominal','abdômen','core','cintura',
  'sono','descanso','recuperação',
];

const { salvarResultado } = require('./lib/fiscal-resultado.cjs');
// Sem envio direto ao Telegram — o guardião aciona Claude que notifica

function extrairKeywords(texto) {
  if (!texto) return new Set();
  const lower = texto.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  return new Set(KEYWORDS.filter(k => lower.includes(k.normalize('NFD').replace(/[̀-ͯ]/g, ''))));
}

function similares(kw1, kw2, tipo) {
  if (kw1.size === 0 || kw2.size === 0) return false;
  const intersecao = [...kw1].filter(k => kw2.has(k));
  // Carrossel exige 3+ keywords em comum (conteúdo mais específico)
  // Kling exige 3+ também (era 2, mas gerava muitos falso-positivos em fitness)
  const minimo = tipo === 'carousel' ? 3 : 3;
  return intersecao.length >= minimo;
}

function carregarSchedule() {
  if (!fs.existsSync(SCHEDULE_DIR)) return {};
  const todas = {};
  fs.readdirSync(SCHEDULE_DIR)
    .filter(f => f.startsWith('week-') && f.endsWith('.json'))
    .sort().reverse().slice(0, 4) // últimas 4 semanas
    .forEach(f => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, f), 'utf8'));
        Object.assign(todas, data.days || {});
      } catch { /* ignora */ }
    });
  return todas;
}

async function salvarTemasUsados(temas) {
  if (!fs.existsSync(SCHEDULE_DIR)) fs.mkdirSync(SCHEDULE_DIR, { recursive: true });
  fs.writeFileSync(TEMAS_FILE, JSON.stringify(temas, null, 2));

  if (!GITHUB_TOKEN) return;

  const content = Buffer.from(JSON.stringify(temas, null, 2)).toString('base64');
  let sha;
  try {
    const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${TEMAS_REPO}`, {
      headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json' },
    });
    if (r.ok) sha = (await r.json()).sha;
  } catch { /* novo */ }

  const body = { message: `chore: temas-usados ${new Date().toISOString().slice(0, 10)}`, content, committer: { name: 'BioNexus Bot', email: 'bot@bionexus.local' } };
  if (sha) body.sha = sha;

  await fetch(`https://api.github.com/repos/${REPO}/contents/${TEMAS_REPO}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: 'application/vnd.github.v3+json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  }).catch(() => {});
}

async function main() {
  const hoje      = new Date().toISOString().slice(0, 10);
  const data      = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  const corte14d  = new Date(Date.now() - DIAS_JANELA * 86400000).toISOString().slice(0, 10);
  const corte28d  = new Date(Date.now() - 28 * 86400000).toISOString().slice(0, 10);

  console.log(`[fiscal-temas-repetidos] Auditando repetição de temas — ${data}`);

  const schedule = carregarSchedule();
  const diasOrdenados = Object.keys(schedule).sort();

  if (diasOrdenados.length < 7) {
    console.log('Dados insuficientes para análise — menos de 7 dias de schedule');
    return;
  }

  // Coleta todos os temas com suas keywords
  const todosTopicos = [];
  diasOrdenados.forEach(d => {
    const day = schedule[d];
    if (day?.carousel?.topic) {
      todosTopicos.push({ data: d, tipo: 'carousel', tema: day.carousel.topic, kw: extrairKeywords(day.carousel.topic) });
    }
    if (day?.reel_kling?.topic) {
      todosTopicos.push({ data: d, tipo: 'kling', tema: day.reel_kling.topic, kw: extrairKeywords(day.reel_kling.topic) });
    }
  });

  // Detecta repetições dentro dos últimos 14 dias
  const repeticoes = [];
  const proximos7  = todosTopicos.filter(t => t.data >= hoje && t.data <= new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10));
  const ultimos14  = todosTopicos.filter(t => t.data >= corte14d && t.data < hoje);

  for (const proximo of proximos7) {
    for (const anterior of ultimos14) {
      if (proximo.tipo !== anterior.tipo) continue;
      if (similares(proximo.kw, anterior.kw, proximo.tipo)) {
        repeticoes.push({
          tipo:        proximo.tipo,
          proximoData: proximo.data,
          proximoTema: proximo.tema,
          anteriorData: anterior.data,
          anteriorTema: anterior.tema,
          kw:          [...proximo.kw].filter(k => anterior.kw.has(k)),
        });
      }
    }
  }

  // Salva temas usados nos últimos 28 dias para o planner consultar
  const temasUsados = {
    geradoEm: new Date().toISOString(),
    janela28d: todosTopicos
      .filter(t => t.data >= corte28d)
      .map(t => ({ data: t.data, tipo: t.tipo, tema: t.tema, keywords: [...t.kw] })),
    repeticoesDetectadas: repeticoes.length,
  };

  await salvarTemasUsados(temasUsados);
  console.log(`Temas salvos: ${temasUsados.janela28d.length} | Repetições: ${repeticoes.length}`);

  if (repeticoes.length === 0) {
    console.log('✅ Diversidade de temas OK — nenhuma repetição detectada.');
    return;
  }

  console.log(`${repeticoes.length} repetição(ões) detectada(s) nos próximos 7 dias.`);

  // Grava resultado para o guardião acionar Claude — não avisa Telegram diretamente
  salvarResultado('temas-repetidos',
    repeticoes.length > 10 ? [`${repeticoes.length} temas repetidos — schedule precisa ser revisado`] : [],
    repeticoes.slice(0, 5).map(r => `${r.tipo} ${r.proximoData}: "${r.proximoTema.slice(0,50)}" similar a ${r.anteriorData}`),
    { repeticoes, totalTemas: temasUsados.janela28d.length,
      instrucao: 'Revise o weekly-planner para evitar temas similares em < 7 dias. Considere atualizar trending-topics.json.' }
  );

  if (repeticoes.length > 10) process.exit(1);
}

main().catch(err => {
  console.error('ERRO FATAL fiscal-temas-repetidos:', err.message);
  process.exit(1);
});
