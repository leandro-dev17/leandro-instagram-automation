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

async function callGemini(prompt) {
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

function buildPrompt(dates, insights) {
  const daysInfo = dates.map(d => `${d} (${getDayName(d)})`).join(', ');
  const insightsContext = buildInsightsContext(insights);

  return `Você é um especialista em marketing de conteúdo para personal trainers brasileiros.

Crie um cronograma de conteúdo para o Instagram de @leandro_personall para os dias: ${daysInfo}.

Perfil: Personal trainer especializado em emagrecimento metabólico feminino e treino por ciclo menstrual. Público: mulheres 25-45 anos que querem emagrecer e entender o próprio corpo.

Tom de voz: científico-empático, sem culpar a mulher, com dados reais, empoderador.${insightsContext}

Para cada dia, gere:
1. Cinco REELS INDIVIDUAIS (imagem vertical 9:16 com texto) — cada um com ângulo/sub-tema diferente do tema do dia
2. Três POSTS FEED ÚNICOS: um motivacional, um educativo e um científico ou de mitos

REGRAS IMPORTANTES:
- Cada dia deve ter tema DIFERENTE dos outros dias
- Os 5 reels do dia devem cobrir 5 ângulos diferentes do mesmo tema principal
- Tipos de reel: motivacional, educativo, cientifico, mitos, dica, treino, nutricao, ciclo
- Os image_prompts devem ser em INGLÊS, ultra-detalhados para gerar fotos realistas
- REGRA ABSOLUTA para reels e posts: TODOS os image_prompts DEVEM mostrar uma mulher fitness. NUNCA gerar infográficos, diagramas, ilustrações, objetos sem pessoa ou cenas sem pessoa humana.
- Estrutura OBRIGATÓRIA de todo image_prompt de reel/post: "[ENQUADRAMENTO] of a beautiful lean athletic fitness woman in her 30s, slim waist, flat toned stomach, defined toned legs and arms, natural realistic body proportions, [APARÊNCIA], wearing [ROUPA DE ACADEMIA], [contexto de academia/treino], warm cinematic lighting, hyperrealistic, photorealistic, 8K, no text, no watermark"
- APARÊNCIA: varie sempre entre estas opções (NÃO repita a mesma no mesmo dia):
  * "with long straight dark brown hair, light tan skin, natural makeup"
  * "with long wavy brunette hair pulled back in ponytail, warm olive skin, brown eyes"
  * "with shoulder-length straight black hair, medium brown skin, natural smile"
  * "with long straight dark hair loose, light tan skin, subtle makeup"
  * "with curly brunette hair tied up, warm medium skin tone, athletic face"
- ROUPA DE ACADEMIA (roupas bonitas e tasteful — NUNCA biquíni ou tanga): varie entre:
  * "yellow high-waist biker shorts and white sports bra, white sneakers"
  * "coral pink high-waist leggings and matching pink sports bra, white sneakers"
  * "dark navy high-waist leggings and light blue crop sports bra, white sneakers"
  * "black high-waist leggings and black sports bra with colorful side stripes, white sneakers"
  * "beige high-waist leggings and matching beige crop sports bra, white sneakers"
- ENQUADRAMENTO: alterne entre estas opções para variar composição:
  * "Full body shot from head to toe" — para mostrar corpo inteiro
  * "Three-quarter body shot from knees to top of head" — meio corpo superior
  * "Waist-up shot" — meio corpo
- POSES SEGURAS (usar sempre — rosto visível, sem costas puras, sem mãos em primeiro plano):
  * "standing confidently with hands on hips, smiling directly at camera"
  * "three-quarter front view, one hand on hip, warm natural smile at camera"
  * "side profile standing tall showing slim waist, looking toward camera smiling"
  * "performing hip thrust on bench with resistance band on thighs, looking at camera"
  * "performing glute bridge on mat, head raised looking at camera smiling"
  * "performing Bulgarian split squat with light dumbbells at sides, smiling at camera"
  * "walking confidently in gym, looking at camera with a smile"
  * "seated on bench looking directly at camera, confident warm smile"
  * "standing in front of gym mirror smiling at camera, full reflection visible"
  * "doing lateral raises with light dumbbells at shoulder height, arms extended"
- NUNCA usar: "back view only", "gripping barbell", "barbell squat close-up", "hands in foreground", "reaching out toward camera", "pointing finger at camera", "infographic", "diagram", "chart", "illustration", "icons", "curvy", "voluptuous", "big glutes", "Brazilian fitness woman", "thong", "bikini"
- REGRA ESPECIAL para dica_receita: o image_prompt DEVE ser fotografia de alimento (SEM pessoa). Use: "Professional food photography, [prato/receita], beautiful plating, vibrant colors, natural window light, [superfície: marble/wooden board/slate], shallow depth of field, hyperrealistic, 8K UHD, Michelin-quality food styling, appetizing, mouth-watering, no text, no watermark"
- Captions em português, conversacionais, com CTA forte no final que FORCE o comentário (ex: "Comenta 🍑 se você quer esse treino", "Digita SIM nos comentários se quer o passo a passo", "Que parte do seu treino você mais odeia? Comenta 👇")
- Headlines DEVEM usar o gatilho de curiosidade — frases que criam lacuna de informação: "O erro que está travando seus glúteos", "Por que suas coxas crescem mas o bumbum não", "A técnica que 90% das mulheres ignora no treino"
- CTAs dos reels e posts DEVEM provocar comentário ou salvamento: use perguntas diretas ao seguidor, desafios, pedidos de confirmação tipo "QUERO" nos comentários, ou informações que fazem a pessoa querer marcar uma amiga
- Hashtags: mix de pequenas (#leandroperssonal), médias e grandes
- Headlines dos reels: curtas e impactantes (máx 55 chars), para ser lida em 2 segundos
- Exemplo de CTAs FORTES: "Comenta TREINO que te mando o PDF 💪", "Marca uma amiga que precisa saber disso 👇", "Você já sabia disso? Comenta SIM ou NÃO", "Salva antes de fechar — você vai querer isso depois 🔖"

Retorne APENAS um JSON válido neste formato exato:

{
  "week_start": "${dates[0]}",
  "week_end": "${dates[dates.length - 1]}",
  "generated_at": "${new Date().toISOString()}",
  "days": {
    "${dates[0]}": {
      "day_name": "${getDayName(dates[0])}",
      "theme": "tema principal do dia",
      "reels_hashtags": "#hashtag1 #hashtag2 #hashtag3 #hashtag4 #hashtag5",
      "reels": [
        {
          "number": 1,
          "type": "motivacional",
          "headline": "Headline curta e impactante",
          "accent": "palavra para destacar em coral",
          "body": "Frase de apoio (máx 100 chars, 2 linhas)",
          "image_prompt": "detailed English prompt for ultra-realistic Stability AI image, vertical format",
          "cta": "💬 Texto do CTA curto"
        },
        {
          "number": 2,
          "type": "educativo",
          "headline": "Headline educativa",
          "accent": "palavra",
          "body": "Informação principal",
          "image_prompt": "detailed English prompt",
          "cta": "💾 CTA para salvar"
        },
        {
          "number": 3,
          "type": "cientifico",
          "headline": "Stat ou fato científico",
          "accent": "número ou palavra",
          "body": "Contexto do dado",
          "image_prompt": "detailed English prompt",
          "cta": "🔬 CTA para comentar"
        },
        {
          "number": 4,
          "type": "dica",
          "headline": "Dica prática",
          "accent": "palavra",
          "body": "Aplicação prática da dica",
          "image_prompt": "detailed English prompt",
          "cta": "📌 CTA para salvar ou marcar"
        },
        {
          "number": 5,
          "type": "mitos",
          "headline": "Mito destruído",
          "accent": "palavra",
          "body": "A verdade sobre isso",
          "image_prompt": "detailed English prompt",
          "cta": "💬 CTA para comentar"
        }
      ],
      "posts": [
        {
          "type": "motivacional",
          "headline": "Headline emocional (máx 55 chars)",
          "accent": "palavra",
          "body": "Texto de apoio (2-3 linhas, máx 120 chars)",
          "caption": "Caption completa com história/empatia e pergunta",
          "hashtags": "#hashtag1 ... (12-15 hashtags)",
          "image_prompt": "detailed English prompt for ultra-realistic image",
          "cta": "💬 Texto do CTA (comenta X, salva, compartilha)"
        },
        {
          "type": "educativo",
          "headline": "Headline educativa",
          "accent": "palavra",
          "body": "Informação principal em 2 linhas",
          "caption": "Caption educativa com valor prático e pergunta",
          "hashtags": "#hashtag1 ...",
          "image_prompt": "detailed English prompt",
          "cta": "💾 CTA para salvar ou marcar alguém"
        },
        {
          "type": "cientifico",
          "headline": "Stat ou fato científico impactante",
          "accent": "número ou palavra chave",
          "body": "Contexto do estudo em 2 linhas",
          "caption": "Caption com fonte, explicação e pergunta",
          "hashtags": "#hashtag1 ...",
          "image_prompt": "detailed English prompt",
          "cta": "🔬 CTA para comentar opinião"
        }
      ]
    }
  }
}

Gere o JSON completo para TODOS os ${dates.length} dias listados. Certifique-se que cada dia tem temas únicos e variados.`;
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

  // Gera em 4 lotes de 2 dias (conteúdo maior com 5 reels por dia)
  const batches = [
    dates.slice(0, 2),
    dates.slice(2, 4),
    dates.slice(4, 6),
    dates.slice(6)
  ].filter(b => b.length > 0);

  const allDays = {};
  for (let i = 0; i < batches.length; i++) {
    console.log(`\nLote ${i+1}/${batches.length}: gerando ${batches[i].map(getDayName).join(', ')}...`);
    const result = await callGemini(buildPrompt(batches[i], insights));
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
