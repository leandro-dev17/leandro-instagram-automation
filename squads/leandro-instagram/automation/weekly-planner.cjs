/**
 * weekly-planner.cjs
 * Gera o cronograma de conteúdo para a próxima semana usando Gemini AI.
 * Execute manualmente uma vez por semana (ex: todo domingo à noite).
 *
 * Uso: node weekly-planner.cjs
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');
const SCHEDULE_DIR = path.join(__dirname, 'schedule');
const REPORTS_DIR = process.env.REPORTS_DIR ||
  (process.platform === 'win32'
    ? 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/Relatórios/Relatório insights instagram'
    : path.join(__dirname, 'reports'));

function loadApiKey() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() === 'ANTHROPIC_API_KEY') return v.join('=').trim();
  }
  throw new Error('ANTHROPIC_API_KEY não encontrada no .env');
}

function getWeekDates() {
  const today = new Date();
  const days = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    days.push(d.toISOString().slice(0, 10));
  }
  return days;
}

function getDayName(dateStr) {
  const names = ['Domingo', 'Segunda-feira', 'Terça-feira', 'Quarta-feira', 'Quinta-feira', 'Sexta-feira', 'Sábado'];
  return names[new Date(dateStr + 'T12:00:00').getDay()];
}

async function callClaude(prompt) {
  const apiKey = loadApiKey();
  const body = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    temperature: 0.85,
    messages: [{ role: 'user', content: prompt }]
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          try {
            const parsed = JSON.parse(data);
            const text = parsed.content?.[0]?.text || '';
            const match = text.match(/\{[\s\S]*\}/);
            if (!match) throw new Error('Nenhum JSON encontrado na resposta');
            resolve(JSON.parse(match[0]));
          } catch (e) {
            reject(new Error('Erro ao parsear Claude: ' + e.message));
          }
        } else {
          reject(new Error(`Claude erro ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function loadLatestInsights() {
  try {
    if (!fs.existsSync(REPORTS_DIR)) return null;
    const files = fs.readdirSync(REPORTS_DIR).filter(f => f.startsWith('relatorio-') && f.endsWith('.json')).sort().reverse();
    if (files.length === 0) return null;
    return JSON.parse(fs.readFileSync(path.join(REPORTS_DIR, files[0]), 'utf8'));
  } catch {
    return null;
  }
}

function buildInsightsContext(insights) {
  if (!insights || !insights.posts || insights.posts.length === 0) return '';

  const sorted = [...insights.posts].sort((a, b) => b.score - a.score);
  const byType = {};
  for (const p of insights.posts) {
    if (!byType[p.type]) byType[p.type] = { scores: [], saves: 0 };
    byType[p.type].scores.push(p.score);
    byType[p.type].saves += p.metrics?.saved || 0;
  }

  const typeRanking = Object.entries(byType)
    .map(([type, data]) => ({
      type,
      avgScore: Math.round(data.scores.reduce((a, b) => a + b, 0) / data.scores.length),
      totalSaves: data.saves
    }))
    .sort((a, b) => b.avgScore - a.avgScore);

  const lines = [
    `\n📊 DADOS DE PERFORMANCE DA SEMANA PASSADA (${insights.weekStart} a ${insights.weekEnd}):`,
    `Use estes dados para priorizar temas e formatos que comprovadamente engajam mais.`,
    ``
  ];

  lines.push(`Ranking de tipos por engajamento:`);
  typeRanking.forEach((t, i) => {
    lines.push(`  ${i + 1}º ${t.type}: score médio ${t.avgScore}, saves ${t.totalSaves}`);
  });

  if (sorted[0]) {
    lines.push(`\nMelhor post da semana: tipo "${sorted[0].type}", score ${sorted[0].score}`);
    lines.push(`Caption do melhor post: "${(sorted[0].caption || '').slice(0, 100)}"`);
  }

  if (typeRanking[0]) {
    lines.push(`\nRECOMENDAÇÃO: Priorize conteúdo do tipo "${typeRanking[0].type}" pois teve maior engajamento.`);
  }
  if (typeRanking[typeRanking.length - 1] && typeRanking.length > 1) {
    lines.push(`ATENÇÃO: Tipo "${typeRanking[typeRanking.length - 1].type}" teve menor engajamento — tente ângulos diferentes.`);
  }

  return lines.join('\n');
}

// Mapeamento de vídeos do pool Kling → temas compatíveis
const VIDEO_POOL_MAP = [
  { id: '01-caminhada-camera-lateral',    temas: 'cardio, emagrecimento, metabolismo, queima de gordura, caminhada' },
  { id: '02-rotacao-360-luz-dourada',     temas: 'glúteo, coxa, pernas, bumbum, leg day, quadril' },
  { id: '03-close-rosto-sorriso',         temas: 'motivação, mindset, nutrição, proteína, dica geral, alimentação' },
  { id: '04-cintura-quadril-movimento',   temas: 'abdômen, cintura, core, hormônios, ciclo menstrual, feminino' },
  { id: '05-camera-baixo-para-cima',      temas: 'força, músculo, braços, superação, treino pesado, intensidade' },
  { id: '06-pernas-andando-close',        temas: 'pernas, panturrilha, cardio leve, passos, caminhada' },
  { id: '09-morena-clara-shoulder-press', temas: 'ombro, postura, parte superior, bíceps, rosca, press' },
];

function buildPrompt(dates, insights) {
  const daysInfo = dates.map(d => `${d} (${getDayName(d)})`).join(', ');
  const insightsContext = buildInsightsContext(insights);

  // Monta exemplo de estrutura para 1 dia
  const exampleDate = dates[0];
  const exampleDay = getDayName(dates[0]);

  const videoPoolDesc = VIDEO_POOL_MAP
    .map(v => `  - "${v.id}" → compatível com: ${v.temas}`)
    .join('\n');

  return `Você é um especialista em marketing de conteúdo viral para personal trainers brasileiros.

Crie um cronograma de conteúdo para o Instagram de @leandro_personall para os dias: ${daysInfo}.

Perfil: Personal trainer especializada em emagrecimento metabólico feminino e treino por ciclo menstrual. Público: mulheres 25-45 anos que querem emagrecer e entender o próprio corpo.

Tom de voz: científico-empático, sem culpar a mulher, com dados reais, empoderador.${insightsContext}

Para cada dia, gere EXATAMENTE:
1. Um STORY (5 slides — mesmo assunto, abordagem narrativa dor → revelação → prova → solução → CTA)
2. Um CARROSSEL de 7 slides para o feed (mesmo assunto, mais profundo e educativo)
3. Um REEL KLING (vídeo de modelo fitness pré-gerado — escolha o video_id mais compatível com o tema do dia)

POOL DE VÍDEOS KLING disponíveis (escolha o mais compatível com o tema):
${videoPoolDesc}

REGRAS DE CONTEÚDO:
- Cada dia deve ter tema DIFERENTE dos outros dias
- Varie os temas entre: glúteos, ciclo menstrual, metabolismo, mitos fitness, treino de força, emagrecimento, alimentação estratégica, motivação real, corpo feminino, desafios comuns
- Hooks VIRAIS obrigatórios: use afirmações polêmicas, números chocantes ou dores diretas — NUNCA perguntas genéricas
  * RUIM: "Você sabe como treinar?"
  * BOM: "Você está treinando errado há anos" / "90% das mulheres ignoram isso" / "Seu bumbum não cresce por 1 motivo"
- CTAs FORTES: "Salva antes de fechar 💾", "Marca a amiga que precisa ver isso 👇", "Comenta QUERO que te mando o plano 📩", "Compartilha com quem luta com isso"
- Captions do carrossel: conversacionais, com história/empatia, pergunta que força comentário no final
- Caption do reel_kling: tom provocativo e polêmico, gera vontade de comentar/compartilhar, termina com pergunta que divide opiniões. Mínimo 100 palavras.
- Hashtags: mix de pequenas (#leandropersonall), médias e grandes — 12-15 no carrossel e reel, 5-8 no story
- video_id do reel_kling: escolha o mais compatível com o tema do dia — NÃO repita o mesmo video_id em dias consecutivos

FORMATO JSON exato:

{
  "week_start": "${dates[0]}",
  "week_end": "${dates[dates.length - 1]}",
  "generated_at": "${new Date().toISOString()}",
  "days": {
    "${exampleDate}": {
      "day_name": "${exampleDay}",
      "theme": "tema principal do dia (ex: Glúteos e Ciclo Menstrual)",
      "story": {
        "topic": "Frase-tema do story (ex: Por que seu glúteo não cresce mesmo treinando todo dia)",
        "type": "dica",
        "caption": "Texto curto para publicar junto ao story (1-2 frases + CTA)",
        "hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5"
      },
      "carousel": {
        "topic": "Tema mais profundo do carrossel (ex: O guia completo de treino de glúteo por fase do ciclo)",
        "type": "educativo",
        "caption": "Caption completa do carrossel — começa com gancho, desenvolve com empatia e dado real, termina com pergunta que força comentário. Mínimo 150 palavras.",
        "hashtags": "#hashtag1 #hashtag2 ... (12-15 hashtags)"
      },
      "reel_kling": {
        "topic": "Tema do reel (ex: Ombro redondo e postura feminina)",
        "video_id": "09-morena-clara-shoulder-press",
        "caption": "Caption provocativa e polêmica sobre o tema — gera vontade de comentar e compartilhar, termina com pergunta que divide opiniões. Mínimo 100 palavras.",
        "hashtags": "#hashtag1 #hashtag2 ... (12-15 hashtags)"
      }
    }
  }
}

IMPORTANTE:
- Gere o JSON completo para TODOS os ${dates.length} dias listados
- Cada dia deve ter temas completamente diferentes dos outros
- Não repita tipos de conteúdo em dias consecutivos
- O topic do story e do carousel do mesmo dia devem ser ângulos diferentes do mesmo tema
- O video_id do reel_kling deve ser escolhido com base no tema e NÃO pode repetir em dias consecutivos`;
}

async function main() {
  console.log('═══════════════════════════════════════════');
  console.log('BioNexus Digital Weekly Planner');
  console.log('═══════════════════════════════════════════');

  if (!fs.existsSync(SCHEDULE_DIR)) fs.mkdirSync(SCHEDULE_DIR, { recursive: true });

  // Coleta insights da semana passada (se disponível)
  let insights = null;
  try {
    console.log('\n📊 Coletando insights da semana passada...');
    const { collectInsights } = require('./weekly-insights.cjs');
    const result = await collectInsights();
    insights = result;
    console.log(`  ✓ ${result.summary.totalPosts} posts analisados`);
    if (result.summary.bestPost) {
      console.log(`  ✓ Melhor conteúdo: ${result.summary.bestPost.type} (score ${result.summary.bestPost.score})`);
    }
  } catch (e) {
    console.log(`  ⚠ Insights não disponíveis: ${e.message}`);
    console.log('  Continuando sem dados de performance...');
  }

  const dates = getWeekDates();
  console.log(`\nGerando cronograma para ${dates.length} dias:`);
  dates.forEach(d => console.log(`  → ${d} (${getDayName(d)})`));

  // Gera em 2 lotes de 3-4 dias (conteúdo mais enxuto: 1 story + 1 carrossel por dia)
  const batches = [
    dates.slice(0, 4),
    dates.slice(4)
  ].filter(b => b.length > 0);

  const allDays = {};
  for (let i = 0; i < batches.length; i++) {
    console.log(`\nLote ${i+1}/${batches.length}: gerando ${batches[i].map(getDayName).join(', ')}...`);
    const result = await callClaude(buildPrompt(batches[i], insights));
    Object.assign(allDays, result.days || {});
    console.log(`  ✓ Lote ${i+1} concluído`);
  }

  const plan = {
    week_start: dates[0],
    week_end: dates[dates.length - 1],
    generated_at: new Date().toISOString(),
    days: allDays
  };

  const filename = `week-${dates[0]}.json`;
  const filepath = path.join(SCHEDULE_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(plan, null, 2), 'utf8');

  const daysGenerated = Object.keys(plan.days).length;
  console.log('');
  console.log('═══════════════════════════════════════════');
  console.log(`✅ Cronograma gerado com sucesso!`);
  console.log(`   Arquivo: schedule/${filename}`);
  console.log(`   Dias planejados: ${daysGenerated}/7`);
  console.log('');
  console.log('O daily-generator.cjs vai usar este cronograma');
  console.log('automaticamente às 5h todos os dias.');
  console.log('═══════════════════════════════════════════');
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
