/**
 * kling-publisher.cjs — Publica Reel Kling no Instagram
 *
 * Pipeline:
 *   1. Lê reel_kling do plano do dia (video_id + caption + hashtags)
 *   2. Copia o vídeo do pool para temp
 *   3. Gera hook provocativo via Claude (3-4 frases curtas para queimar no vídeo)
 *   4. Queima o hook no vídeo via ffmpeg drawtext (texto aparece e some a cada 2.5s)
 *   5. Faz upload para Cloudinary
 *   6. Publica como Reel no Instagram
 *   7. Publica no YouTube Shorts
 *   8. Notifica Telegram
 *
 * Uso: node kling-publisher.cjs [YYYY-MM-DD]
 */

'use strict';

const fs             = require('fs');
const path           = require('path');
const { execSync }   = require('child_process');

// ── Carrega .env ────────────────────────────────────────────────────────────────
(function loadEnvFile() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) {
      process.env[k.trim()] = v.join('=').trim();
    }
  }
})();

const { uploadVideo }                             = require('./lib/cloudinary.cjs');
const { publishReel, refreshTokenIfNeeded, loadEnv } = require('./lib/instagram.cjs');
const { lerTrackingCompleto, salvarTracking }     = require('./lib/tracking-github.cjs');
const { publishShort }                            = require('./lib/youtube.cjs');
const { notifyReel, notifyError }                 = require('./lib/telegram.cjs');

const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const LOGS_DIR     = path.join(__dirname, 'logs');
const POOL_DIR     = path.join(__dirname, 'kling-pool');
const TEMP_DIR     = process.env.TEMP_DIR ||
  (process.platform === 'win32'
    ? path.join(__dirname, 'temp')   // Windows local: usa automation/temp já existente
    : '/tmp/bionexus_render');       // Linux CI: pasta padrão

// ── Pool de vídeos aprovados ─────────────────────────────────────────────────────
// model: identidade visual da modelo (para evitar repetir mesma modelo em dias seguidos)
// style: tipo de movimento/câmera (para variar entre dias)
// priority: 2=diversa (nova), 1=original morena-rosa (usar só se necessário)
const VIDEO_POOL = [
  // Originais — mesma morena clara de rosa (priority 1 = usar só se sem alternativa)
  { id: '01-caminhada-camera-lateral',         file: '01-caminhada-camera-lateral.mp4',         tags: ['cardio','emagrecer','metabolismo','queima','gordura','caminhada'],        model: 'morena-rosa', style: 'caminhada-lateral',  priority: 1 },
  { id: '02-rotacao-360-luz-dourada',          file: '02-rotacao-360-luz-dourada.mp4',          tags: ['glúteo','gluteo','coxa','perna','bumbum','leg','quadril'],                model: 'morena-rosa', style: 'rotacao-360',        priority: 1 },
  { id: '03-close-rosto-sorriso',              file: '03-close-rosto-sorriso.mp4',              tags: ['motivação','motivacao','mindset','nutrição','nutricao','dica'],           model: 'morena-rosa', style: 'close-rosto',        priority: 1 },
  { id: '04-cintura-quadril-movimento',        file: '04-cintura-quadril-movimento.mp4',        tags: ['abdômen','abdomen','cintura','core','hormônio','ciclo','feminino'],       model: 'morena-rosa', style: 'cintura-quadril',    priority: 1 },
  { id: '05-camera-baixo-para-cima',           file: '05-camera-baixo-para-cima.mp4',           tags: ['força','forca','músculo','musculo','braço','superação','intensidade'],   model: 'morena-rosa', style: 'angulo-baixo',       priority: 1 },
  { id: '06-pernas-andando-close',             file: '06-pernas-andando-close.mp4',             tags: ['perna','panturrilha','cardio','passos'],                                 model: 'morena-rosa', style: 'pernas-close',       priority: 1 },
  { id: '09-morena-clara-shoulder-press',      file: '09-morena-clara-shoulder-press.mp4',      tags: ['ombro','postura','superior','bíceps','biceps','rosca','press'],          model: 'morena-rosa', style: 'shoulder-press',     priority: 1 },
  // Diversas — modelos e roupas diferentes (priority 2 = preferência sempre)
  { id: '10-loira-verde-rotacao',              file: '10-loira-verde-rotacao.mp4',              tags: ['glúteo','pernas','bumbum','quadril'],                                    model: 'loira-verde',         style: 'rotacao-360',        priority: 2 },
  { id: '11-ruiva-lilas-caminhada-frontal',    file: '11-ruiva-lilas-caminhada-frontal.mp4',    tags: ['cardio','emagrecimento','metabolismo','caminhada','energia'],             model: 'ruiva-lilas',         style: 'caminhada-frontal',  priority: 2 },
  { id: '12-morena-escura-coral-ombro',        file: '12-morena-escura-coral-ombro.mp4',        tags: ['ombro','postura','parte superior','bíceps','força'],                     model: 'morena-escura-coral', style: 'shoulder-press',     priority: 2 },
  { id: '13-loira-curta-azul-angulo-baixo',    file: '13-loira-curta-azul-angulo-baixo.mp4',    tags: ['força','músculo','superação','intensidade','treino pesado'],              model: 'loira-azul',          style: 'angulo-baixo',       priority: 2 },
  { id: '14-morena-ondulada-preta-pernas-close', file: '14-morena-ondulada-preta-pernas-close.mp4', tags: ['pernas','panturrilha','abdômen','ciclo','feminino'],                 model: 'morena-preta',        style: 'pernas-close',       priority: 2 },
  { id: '15-negra-vermelho-cintura-quadril',   file: '15-negra-vermelho-cintura-quadril.mp4',   tags: ['motivação','mindset','nutrição','proteína','dica','alimentação'],        model: 'negra-vermelha',      style: 'cintura-quadril',    priority: 2 },
  // Segunda rodada de vídeos diversos (gerados automaticamente pelo generate-pool-video.cjs)
  { id: '16-negra-verde-rotacao',              file: '16-negra-verde-rotacao.mp4',              tags: ['glúteo','pernas','bumbum','quadril','metabolismo'],                      model: 'negra-verde',         style: 'rotacao-360',        priority: 2 },
  { id: '17-loira-laranja-caminhada',          file: '17-loira-laranja-caminhada.mp4',          tags: ['cardio','emagrecimento','queima','gordura','energia','disposição'],      model: 'loira-laranja',       style: 'caminhada-frontal',  priority: 2 },
  { id: '18-ruiva-preto-angulo-baixo',         file: '18-ruiva-preto-angulo-baixo.mp4',         tags: ['força','músculo','superação','intensidade','braço','biceps'],            model: 'ruiva-preta',         style: 'angulo-baixo',       priority: 2 },
  { id: '19-morena-lilas-cintura-quadril',     file: '19-morena-lilas-cintura-quadril.mp4',     tags: ['abdômen','cintura','core','hormônio','ciclo','feminino','silhueta'],     model: 'morena-lilas',        style: 'cintura-quadril',    priority: 2 },
  { id: '20-negra-azul-ombro',                 file: '20-negra-azul-ombro.mp4',                 tags: ['ombro','postura','superior','força','parte superior'],                   model: 'negra-azul',          style: 'shoulder-press',     priority: 2 },
  { id: '21-loira-platinada-branco-close',     file: '21-loira-platinada-branco-close.mp4',     tags: ['motivação','mindset','dica','nutrição','proteína','alimentação'],        model: 'loira-branca',        style: 'close-rosto',        priority: 2 },
  { id: '22-ruiva-amarelo-pernas-close',       file: '22-ruiva-amarelo-pernas-close.mp4',       tags: ['pernas','panturrilha','glúteo','coxa','ciclo','feminino'],               model: 'ruiva-amarela',       style: 'pernas-close',       priority: 2 },
  { id: '23-morena-escura-branco-rotacao',     file: '23-morena-escura-branco-rotacao.mp4',     tags: ['glúteo','bumbum','quadril','emagrecimento','resultado'],                 model: 'morena-branca',       style: 'rotacao-360',        priority: 2 },
  { id: '24-negra-afro-amarelo-caminhada',     file: '24-negra-afro-amarelo-caminhada.mp4',     tags: ['cardio','metabolismo','queima','disposição','emagrecimento'],            model: 'negra-amarela',       style: 'caminhada-frontal',  priority: 2 },
  { id: '25-loira-curta-verde-angulo-baixo',   file: '25-loira-curta-verde-angulo-baixo.mp4',   tags: ['força','superação','intensidade','treino pesado','músculo'],             model: 'loira-verde-escuro',  style: 'angulo-baixo',       priority: 2 },
];

// Grade semanal: cada dia da semana tem modelo preferida + estilo preferido
// Garante que a semana toda seja visualmente variada — agora com pool expandido de 16 modelos diversas
const WEEKLY_SCHEDULE = {
  0: { model: 'negra-amarela',       style: 'caminhada-frontal' }, // Dom
  1: { model: 'ruiva-lilas',         style: 'caminhada-frontal' }, // Seg
  2: { model: 'loira-verde',         style: 'rotacao-360'       }, // Ter
  3: { model: 'morena-escura-coral', style: 'shoulder-press'    }, // Qua
  4: { model: 'loira-azul',          style: 'angulo-baixo'      }, // Qui
  5: { model: 'morena-preta',        style: 'pernas-close'      }, // Sex
  6: { model: 'negra-verde',         style: 'rotacao-360'       }, // Sáb
};

// ── Sincroniza pool do disco (detecta vídeos novos gerados automaticamente) ──────
function syncPoolFromDisk() {
  if (!fs.existsSync(POOL_DIR)) return;
  const onDisk = fs.readdirSync(POOL_DIR).filter(f => f.endsWith('.mp4'));
  for (const file of onDisk) {
    const id = file.replace('.mp4', '');
    if (!VIDEO_POOL.find(v => v.id === id)) {
      VIDEO_POOL.push({ id, file, tags: [] });
    }
  }
}

// ── Retorna histórico de uso dos últimos N dias (lê do GitHub para diversidade real) ──
async function getRecentUsage(days = 14) {
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  const usage = {}; // { videoId: lastUsedDate }
  try {
    // Usa lerTrackingCompleto para obter histórico real do GitHub (não só local)
    const tracking = await lerTrackingCompleto(trackingFile);
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    for (const [dateStr, posts] of Object.entries(tracking)) {
      if (new Date(dateStr) < cutoff) continue;
      const videoId = posts['kling-reel']?.videoId;
      if (!videoId) continue;
      if (!usage[videoId] || dateStr > usage[videoId]) usage[videoId] = dateStr;
    }
  } catch {}
  return usage;
}

// ── Escolhe o vídeo ideal: grade semanal + diversidade de modelo + anti-repetição ─
// NOTA: virou async porque getRecentUsage agora lê do GitHub
async function pickBestVideo(requestedId, theme) {
  syncPoolFromDisk();
  const usage   = await getRecentUsage(21);
  const today   = new Date().toISOString().slice(0, 10);
  const weekday = new Date(today + 'T12:00:00').getDay();
  const preferred = WEEKLY_SCHEDULE[weekday] || {};

  function daysSinceUsed(videoId) {
    if (!usage[videoId]) return 999;
    return Math.round((new Date(today) - new Date(usage[videoId])) / 86400000);
  }

  // Coleta modelos e estilos usados nos últimos 3 dias (usa tracking completo do GitHub)
  const recentModels = new Set();
  const recentStyles = new Set();
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  const tracking = await lerTrackingCompleto(trackingFile);
  const sortedDates = Object.keys(tracking).sort().slice(-3);
  for (const d of sortedDates) {
    const vid = tracking[d]?.['kling-reel']?.videoId;
    const entry = VIDEO_POOL.find(v => v.id === vid);
    if (entry) { recentModels.add(entry.model); recentStyles.add(entry.style); }
  }

  const available = VIDEO_POOL.filter(v => fs.existsSync(path.join(POOL_DIR, v.file)));
  if (available.length === 0) throw new Error('Nenhum vídeo disponível no pool.');

  // REGRA PRINCIPAL: vídeos priority 2 (diversas) SEMPRE preferidos sobre priority 1 (morena-rosa)
  // Só usa priority 1 se não houver NENHUM priority 2 disponível no disco
  const priority2Available = available.filter(v => (v.priority || 1) === 2);
  const pool = priority2Available.length > 0 ? priority2Available : available;

  // Sistema de pontuação — aplicado apenas ao pool filtrado (priority 2 ou todos se não houver)
  const themeLower = (theme || '').toLowerCase();
  const scored = pool.map(v => {
    let score = 0;
    score += daysSinceUsed(v.id) * 3;                             // +3 por dia sem uso (aumentado)
    if (v.model === preferred.model) score += 50;                  // +50 se é a modelo do dia (aumentado)
    if (v.style === preferred.style) score += 25;                  // +25 se é o estilo do dia (aumentado)
    if (recentModels.has(v.model)) score -= 60;                    // -60 se modelo apareceu nos últimos 3 dias
    if (recentStyles.has(v.style)) score -= 30;                    // -30 se estilo apareceu nos últimos 3 dias
    if (daysSinceUsed(v.id) < 7) score -= 20;                     // -20 se usado na última semana (reduzido)
    if (v.tags.some(t => themeLower.includes(t))) score += 15;    // +15 por compatibilidade de tema
    return { entry: v, score };
  });

  scored.sort((a, b) => b.score - a.score);
  const chosen = scored[0].entry;

  log(`  📊 Grade semanal: modelo="${preferred.model}" estilo="${preferred.style}"`);
  log(`  📊 Pool prioritário: ${pool.length} vídeos diverse (priority 2) de ${available.length} no disco`);
  log(`  📊 Modelos recentes (últimos 3 dias): ${[...recentModels].join(', ') || 'nenhuma'}`);
  log(`  📊 Escolhido: ${chosen.id} (model=${chosen.model}, style=${chosen.style}, score=${scored[0].score})`);

  if (requestedId && chosen.id !== requestedId) {
    log(`  🔄 Substituído: "${requestedId}" → "${chosen.id}" (melhor variedade visual)`);
  }

  return chosen;
}

// ── Auto-gera novo vídeo em background se pool diverso estiver esgotado ──────────
async function schedulePoolRefresh() {
  const usage = await getRecentUsage(7);
  // Conta apenas vídeos priority 2 (diversas) disponíveis no disco e não usados recentemente
  const diverseAvailable = VIDEO_POOL.filter(v => v.priority === 2 && fs.existsSync(path.join(POOL_DIR, v.file)));
  const freshDiverse = diverseAvailable.filter(v => !usage[v.id]);

  if (freshDiverse.length <= 3) {
    log(`  ℹ️  Pool diverso com poucos vídeos frescos (${freshDiverse.length} de ${diverseAvailable.length}) — agendando geração automática em background`);
    const genScript = path.join(__dirname, 'generate-pool-video.cjs');
    if (fs.existsSync(genScript)) {
      const { spawn } = require('child_process');
      const proc = spawn('node', [genScript], {
        detached: true,
        stdio: 'ignore',
        cwd: __dirname
      });
      proc.unref();
      log(`  ✅ generate-pool-video.cjs iniciado em background (PID ${proc.pid})`);
    }
  }
}

// ── Utilitários ─────────────────────────────────────────────────────────────────

function log(msg) {
  const ts   = new Date().toISOString();
  const line = `[${ts}] ${msg}`;
  console.log(line);
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.appendFileSync(path.join(LOGS_DIR, 'kling-publisher.log'), line + '\n');
}

function today() {
  const arg = process.argv[2];
  if (arg && /^\d{4}-\d{2}-\d{2}$/.test(arg)) return arg;
  return new Date().toISOString().slice(0, 10);
}

function findDayPlan(dateStr) {
  if (!fs.existsSync(SCHEDULE_DIR)) return null;
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files.sort().reverse()) {
    const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
    if (plan.days && plan.days[dateStr]) return plan.days[dateStr];
  }
  return null;
}

async function resolveVideoPath(videoId, theme) {
  const best = await pickBestVideo(videoId, theme);
  const p = path.join(POOL_DIR, best.file);
  if (best.id !== videoId) {
    log(`  🔄 Substituído: "${videoId}" → "${best.id}" (melhor opção para evitar repetição)`);
  }
  return { path: p, videoId: best.id };
}

async function savePublished(dateStr, data) {
  const trackingFile = path.join(LOGS_DIR, 'published-posts.json');
  // Lê tracking completo do GitHub para não sobrescrever entradas de outros jobs
  let tracking = await lerTrackingCompleto(trackingFile);
  if (!tracking[dateStr]) tracking[dateStr] = {};
  tracking[dateStr]['kling-reel'] = { ...data, publishedAt: new Date().toISOString() };
  // Salva local E commita no GitHub
  await salvarTracking(trackingFile, tracking);
}

// ── Gerador de hook provocativo via Claude ──────────────────────────────────────
async function generateHook(topic, caption) {
  const Anthropic = require('@anthropic-ai/sdk');
  const client    = new Anthropic.default({ apiKey: process.env.ANTHROPIC_API_KEY });

  const prompt = `Você é o melhor copywriter de Instagram do Brasil especializado em fitness feminino.

Crie 4 frases de hook para queimar em um Reel de 10 segundos de @leandro_personall (personal trainer para mulheres).
Cada frase aparece por 2.5 segundos — precisa ser impactante o suficiente para a pessoa parar o dedo e comentar.

Tema: "${topic}"
Contexto: "${(caption || '').slice(0, 150)}"

ESCOLHA um destes estilos (o mais impactante para o tema):

ESTILO A — Dor + Diagnóstico Chocante (revela algo que ela nunca percebeu):
Exemplo:
  "Você malha todo dia"
  "e ainda não emagrece."
  "O problema não é esforço."
  "Isso muda tudo."

ESTILO B — Acusação Social (faz ela pensar em alguém conhecido):
Exemplo:
  "Sua amiga emagreceu"
  "sem malhar mais."
  "Foi isso que ela mudou."
  "E você não sabe."

ESTILO C — Segredo + Traição (faz ela questionar o que aprendeu):
Exemplo:
  "Seu personal escondeu."
  "Não por maldade."
  "Funciona demais."
  "Assusta quem cobra R$300."

ESTILO D — Identidade + Provocação (mexe com quem ela acha que é):
Exemplo:
  "Você não é sedentária."
  "Nunca teve método real."
  "Método é isso."
  "Sedentária é quem para."

ESTRUTURA OBRIGATÓRIA — 4 segmentos, cada um com 3 linhas curtas (aparecem juntas por 2.5s):

Cada segmento = 3 linhas que formam uma ideia completa e impactante.
Exemplo de segmento bem construído:
  l1: "Você malha todo dia"
  l2: "come direito"
  l3: "e ainda não emagrece."

Outro exemplo:
  l1: "Sua amiga perdeu 8kg."
  l2: "Sem academia extra."
  l3: "Ela mudou apenas isso."

REGRAS ABSOLUTAS:
- EXATAMENTE 4 segmentos (s1 a s4)
- Cada linha: MÁXIMO 18 caracteres — rígido, sem exceção. Conte os caracteres antes de escrever. Prefira frases curtas e impactantes, nunca ultrapasse 18 caracteres incluindo espaços
- Use PT-BR correto com todos os acentos: ã, é, ê, ç, ô, etc.
- SEM emojis, SEM hashtags
- Tom: íntimo, direto, levemente provocativo — como uma amiga que sabe mais
- s1 deve fisgar atenção nos primeiros 2.5 segundos
- s4 é o fechamento: deve terminar com um CTA CONVERSACIONAL e descontraído que convida a pessoa a comentar de forma natural — NÃO use "Comenta X aqui", "Salva esse post" ou qualquer CTA genérico. Use perguntas genuínas como: "Você já conhecia isso?", "O que você acha?", "Você concorda?", "Já fez isso antes?", "Me conta o que você sentiu", "Faz sentido pra você?", "Você já tinha ouvido falar?" — escolha a mais natural para o contexto
- Cada linha deve fazer sentido sozinha E com as outras do segmento

Responda APENAS com JSON válido, sem texto antes ou depois:
{
  "s1_l1": "máx 18 chars",
  "s1_l2": "máx 18 chars",
  "s1_l3": "máx 18 chars",
  "s2_l1": "máx 18 chars",
  "s2_l2": "máx 18 chars",
  "s2_l3": "máx 18 chars",
  "s3_l1": "máx 18 chars",
  "s3_l2": "máx 18 chars",
  "s3_l3": "máx 18 chars",
  "s4_l1": "pergunta CTA, máx 18 chars",
  "s4_l2": "",
  "s4_l3": ""
}`;

  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{ role: 'user', content: prompt }]
  });

  const text  = response.content[0].text.trim();
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) {
    log('⚠ Claude não retornou JSON — usando hook genérico');
    return [
      { l1: 'Treino', l2: 'feminino', l3: 'completo' },
      { l1: 'Resultados', l2: 'reais', l3: 'garantidos' },
      { l1: 'Comece', l2: 'hoje', l3: 'mesmo' },
      { l1: 'Salva e', l2: '', l3: '' }
    ];
  }
  let parsed;
  try { parsed = JSON.parse(match[0]); }
  catch {
    log('⚠ JSON do Claude inválido — usando hook genérico');
    return [
      { l1: 'Treino', l2: 'feminino', l3: 'completo' },
      { l1: 'Resultados', l2: 'reais', l3: 'garantidos' },
      { l1: 'Comece', l2: 'hoje', l3: 'mesmo' },
      { l1: 'Salva e', l2: '', l3: '' }
    ];
  }

  // s1-s3: 3 linhas. s4: apenas 1 linha (CTA conversacional)
  // safeTrunc: nunca corta no meio de palavra — retrocede até o último espaço
  return [
    { l1: safeTrunc(parsed['s1_l1'], 18), l2: safeTrunc(parsed['s1_l2'], 18), l3: safeTrunc(parsed['s1_l3'], 18) },
    { l1: safeTrunc(parsed['s2_l1'], 18), l2: safeTrunc(parsed['s2_l2'], 18), l3: safeTrunc(parsed['s2_l3'], 18) },
    { l1: safeTrunc(parsed['s3_l1'], 18), l2: safeTrunc(parsed['s3_l2'], 18), l3: safeTrunc(parsed['s3_l3'], 18) },
    { l1: safeTrunc(parsed['s4_l1'], 18), l2: '', l3: '' }  // CTA: mesmo limite das outras linhas
  ];
}

// ── Queima hook no vídeo via ffmpeg drawtext ────────────────────────────────────

function escapeDrawtextPath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');
}

// Escapa texto para uso inline no parâmetro text= do ffmpeg drawtext
// Resolve problema de acentos no Windows com textfile= (encoding issue)
function escapeDrawtextInline(text) {
  return text
    .replace(/\\/g, '\\\\')   // \ → \\
    .replace(/'/g, "\\'")      // ' → \'
    .replace(/:/g, '\\:')      // : → \:
    .replace(/\[/g, '\\[')     // [ → \[
    .replace(/\]/g, '\\]');    // ] → \]
}

// hookSegments: array de {l1, l2, l3} — cada segmento ocupa 10s/N do vídeo
// 3 drawtext separados por segmento, posicionados manualmente como bloco centrado
// Usa borderw (outline) em vez de box — sem sobreposição de fundos
function burnHookText(inputMp4, outputMp4, hookSegments) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  const rawFontPath = process.platform === 'win32'
    ? 'C:/Windows/Fonts/arialbd.ttf'
    : '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf';
  const fontPath = escapeDrawtextPath(rawFontPath);

  const FS = 38;  // font size — reduzido para caber em 720px (era 46, overflow confirmado)
  const SP = 14;  // espaçamento entre linhas (px)

  const segDuration = (10 / hookSegments.length).toFixed(3);
  const drawFilters = [];

  const style = [
    `fontsize=${FS}`,
    `fontcolor=white`,
    `borderw=4`,
    `bordercolor=black@0.90`,
    `shadowcolor=black@0.55`,
    `shadowx=0`,
    `shadowy=3`
  ].join(':');

  hookSegments.forEach((seg, i) => {
    const start    = (i * parseFloat(segDuration)).toFixed(2);
    const end      = ((i + 1) * parseFloat(segDuration)).toFixed(2);
    const timeExpr = `enable='between(t,${start},${end})'`;

    const lines = [seg.l1, seg.l2, seg.l3].filter(Boolean);
    const n  = lines.length;
    const BH = n * FS + (n - 1) * SP; // altura total do bloco

    lines.forEach((line, li) => {
      const yOffset = li * (FS + SP);
      const yPos    = `(h-${BH})/2+${yOffset}`;
      const safeText = escapeDrawtextInline(line);
      drawFilters.push([
        `drawtext=fontfile='${fontPath}'`,
        `text='${safeText}'`,
        `x=max(10\\,(w-text_w)/2)`,
        `y=${yPos}`,
        style,
        timeExpr
      ].join(':'));
    });
  });

  const vf = drawFilters.join(',');

  execSync(
    `ffmpeg -y -i "${inputMp4}" -vf "${vf}" -c:v libx264 -pix_fmt yuv420p -movflags +faststart "${outputMp4}"`,
    { stdio: 'inherit' }
  );
}

// ── Truncagem segura por palavra (evita cortar no meio de uma palavra) ──────────
function safeTrunc(str, max) {
  if (!str || str.length <= max) return str || '';
  const cut = str.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 2 ? cut.slice(0, lastSpace) : str.slice(0, max);
}

// ── MAIN ────────────────────────────────────────────────────────────────────────
async function main() {
  const dateStr = today();

  // ── Lock file — impede execução simultânea (evita publicação dupla) ─────────
  const lockFile = path.join(LOGS_DIR, 'kling-publisher.lock');
  if (fs.existsSync(lockFile)) {
    const lockContent = fs.readFileSync(lockFile, 'utf8').trim();
    // Verifica se o PID do lock ainda está ativo — se não estiver, é lock fantasma
    const pidMatch = lockContent.match(/PID=(\d+)/);
    const pid = pidMatch ? parseInt(pidMatch[1]) : null;
    let processAlive = false;
    if (pid) {
      try { process.kill(pid, 0); processAlive = true; } catch {}
      if (!processAlive && process.platform === 'win32') {
        try {
          const { execSync } = require('child_process');
          const out = execSync(`tasklist /FI "PID eq ${pid}" /NH 2>nul`, { encoding: 'utf8' });
          processAlive = out.includes(String(pid));
        } catch {}
      }
    }
    const lockAge = Date.now() - fs.statSync(lockFile).mtimeMs;
    const lockTooOld = lockAge > 90 * 60 * 1000; // mais de 90 minutos = lock obsoleto
    if (processAlive && !lockTooOld) {
      log(`⚠ Já existe instância rodando (${lockContent}). Abortando para evitar publicação dupla.`);
      process.exit(0);
    } else {
      const reason = lockTooOld ? `lock com ${Math.round(lockAge/60000)}min (muito antigo)` : `PID ${pid} não existe mais`;
      log(`⚠ Lock fantasma detectado (${reason}) — removendo e continuando.`);
      fs.unlinkSync(lockFile);
    }
  }
  if (!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR, { recursive: true });
  fs.writeFileSync(lockFile, `PID=${process.pid} started=${new Date().toISOString()}`);
  const removeLock = () => { try { fs.unlinkSync(lockFile); } catch {} };
  process.on('exit', removeLock);
  process.on('SIGINT', removeLock);
  process.on('SIGTERM', removeLock);

  log('═══════════════════════════════════════════');
  log(`Kling Reel Publisher — ${dateStr}`);
  log('═══════════════════════════════════════════');

  // Verifica se já foi publicado hoje — lê do GITHUB para pegar publicações de outros jobs
  const trackingFilePath = path.join(LOGS_DIR, 'published-posts.json');
  try {
    const existingTracking = await lerTrackingCompleto(trackingFilePath);
    if (existingTracking[dateStr]?.['kling-reel']) {
      log(`⚠ Kling reel já publicado hoje às ${existingTracking[dateStr]['kling-reel'].publishedAt} (ID: ${existingTracking[dateStr]['kling-reel'].postId}). Abortando para evitar duplicata.`);
      process.exit(0);
    }
  } catch (err) {
    log(`⚠ Erro ao verificar tracking no GitHub: ${err.message} — continuando`);
  }

  // 1. Carrega plano do dia
  const dayPlan = findDayPlan(dateStr);
  if (!dayPlan) {
    const err = `Nenhum cronograma encontrado para ${dateStr}. Execute weekly-planner.cjs.`;
    log(`ERRO: ${err}`);
    await notifyError('kling-publisher.cjs', err);
    process.exit(1);
  }

  const reelKling = dayPlan.reel_kling;
  if (!reelKling || !reelKling.video_id) {
    const err = `Campo reel_kling não encontrado no plano de ${dateStr}. Regenere o cronograma.`;
    log(`ERRO: ${err}`);
    await notifyError('kling-publisher.cjs', err);
    process.exit(1);
  }

  log(`Tema: ${reelKling.topic}`);
  log(`Vídeo solicitado: ${reelKling.video_id}`);

  // 2. Seleciona melhor vídeo (anti-repetição) e localiza no pool
  const { path: poolVideoPath, videoId: chosenVideoId } = await resolveVideoPath(reelKling.video_id, reelKling.topic);
  log(`Pool: ${poolVideoPath}`);

  // Dispara geração de novos vídeos em background se pool estiver ficando sem frescos
  await schedulePoolRefresh();

  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });

  // 3. Gera hook provocativo via Claude
  log('\n✍️  Gerando hook provocativo via Claude...');
  let hookLines;
  try {
    hookLines = await generateHook(reelKling.topic, reelKling.caption);
    log('  Hook gerado:');
    hookLines.forEach((l, i) => log(`    [${i + 1}] "${[l.l1,l.l2,l.l3].filter(Boolean).join(' | ')}"`));
  } catch (err) {
    log(`  ⚠ Claude falhou para hook (${err.message}) — usando fallback genérico`);
    hookLines = [
      { l1: 'Isso vai mudar', l2: 'seu treino.', l3: 'A maioria ignora.' },
      { l1: 'Os resultados', l2: 'provam isso', l3: 'todo dia.' },
      { l1: 'Você ainda nao', l2: 'fez isso?', l3: 'Hora de mudar.' },
      { l1: 'Ja fez antes?', l2: '', l3: '' }
    ];
  }

  // Adiciona 5º segmento fixo — CTA para ler a descrição
  const ctaDescricao = { l1: 'Leia a descricao', l2: 'tem muito mais', l3: 'aqui embaixo!' };
  const hookWithCta = [...hookLines, ctaDescricao];

  // 4. Queima hook no vídeo via ffmpeg
  const outputMp4 = path.join(TEMP_DIR, `kling-reel-${dateStr}-${Date.now()}.mp4`);
  log('\n🎬 Queimando hook no vídeo via ffmpeg...');
  burnHookText(poolVideoPath, outputMp4, hookWithCta);
  const sizeMb = (fs.statSync(outputMp4).size / 1024 / 1024).toFixed(1);
  log(`  ✅ Vídeo com hook: ${path.basename(outputMp4)} (${sizeMb} MB)`);

  // 5. Carrega credenciais Instagram
  const env   = loadEnv();
  const token = await refreshTokenIfNeeded(env);
  const userId = env.INSTAGRAM_USER_ID;

  // 6. Upload para Cloudinary
  log('\n📤 Upload para Cloudinary...');
  const videoUrl = await uploadVideo(outputMp4);
  log(`  ✅ URL: ${videoUrl}`);

  // 7. Monta caption final
  const caption = [
    reelKling.caption || '',
    '',
    reelKling.hashtags || '',
    '',
    'Segue @leandro_personall para mais dicas de treino feminino! 💪'
  ].join('\n').trim();

  // 8. Publica no Instagram como Reel
  log('\n📱 Publicando Reel no Instagram...');
  const postId = await publishReel(videoUrl, caption, token, userId);
  log(`  ✅ Instagram ID: ${postId}`);

  // 9. Publica no YouTube Shorts
  let youtubeId = null;
  if (env.YOUTUBE_REFRESH_TOKEN) {
    log('\n▶️  Publicando no YouTube Shorts...');
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const ytTitle = `${reelKling.topic} #Shorts`;
        youtubeId = await publishShort(videoUrl, ytTitle, caption);
        log(`  ✅ YouTube ID: ${youtubeId}`);
        break;
      } catch (err) {
        if (attempt < 3) {
          log(`  ⚠ YouTube tentativa ${attempt}/3 falhou: ${err.message} — aguardando 10s...`);
          await new Promise(r => setTimeout(r, 10000));
        } else {
          log(`  ⚠ YouTube falhou após 3 tentativas (Instagram OK): ${err.message}`);
        }
      }
    }
  } else {
    log('  ⚠ YOUTUBE_REFRESH_TOKEN não configurado — pulando YouTube.');
  }

  // 10. Notificação Telegram
  await notifyReel('kling', reelKling.topic, postId, dateStr, youtubeId);

  // 11. Rastreamento
  await savePublished(dateStr, {
    postId,
    youtubeId,
    type: 'kling-reel',
    topic: reelKling.topic,
    videoId: chosenVideoId,
    hook: hookLines
  });

  // 12. Limpa MP4 temporário
  try { fs.unlinkSync(outputMp4); } catch {}

  log('');
  log('═══════════════════════════════════════════');
  log('✅ REEL KLING PUBLICADO!');
  log(`   📱 Instagram ID: ${postId}`);
  if (youtubeId) log(`   ▶️  YouTube ID:   ${youtubeId}`);
  log(`   Tema: ${reelKling.topic}`);
  log(`   Vídeo: ${chosenVideoId}`);
  const fmtSeg = s => [s.l1, s.l2, s.l3].filter(Boolean).join(' / ');
  log(`   Hook: "${fmtSeg(hookLines[0])}" → "${fmtSeg(hookLines[hookLines.length - 1])}"`);
  hookLines.forEach((l, i) => log(`     [${i+1}] ${[l.l1,l.l2,l.l3].filter(Boolean).join(' | ')}`)  );
  log('═══════════════════════════════════════════');
}

main().catch(async err => {
  // Garante que o lock é removido mesmo em erro fatal
  const lockFile = require('path').join(__dirname, 'logs', 'kling-publisher.lock');
  try { require('fs').unlinkSync(lockFile); } catch {}
  const msg = `💥 ERRO FATAL: ${err.message}\n${err.stack}`;
  console.error(msg);
  try {
    // Loga o erro no arquivo para diagnóstico futuro
    const logsDir = require('path').join(__dirname, 'logs');
    require('fs').appendFileSync(
      require('path').join(logsDir, 'kling-publisher.log'),
      `[${new Date().toISOString()}] ${msg}\n`
    );
  } catch {}
  try { await notifyError('kling-publisher.cjs', err.message); } catch {}
  process.exit(1);
});
