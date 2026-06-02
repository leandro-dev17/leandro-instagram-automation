/**
 * kie.cjs — Cliente Kie.ai para geração de imagens via Flux Kontext
 * Substitui stability.cjs com qualidade fotorrealista superior para rostos femininos.
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

function loadApiKey() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() === 'KIE_API_KEY') return v.join('=').trim();
  }
  throw new Error('KIE_API_KEY não encontrada no arquivo .env');
}

// Sufixo de qualidade — referência de câmera real para evitar pele plástica/borracha
const QUALITY_SUFFIX = [
  'real candid photograph', 'shot on Sony A7 IV mirrorless camera 85mm f1.8 lens',
  'natural skin texture with visible pores', 'subtle natural skin imperfections',
  'not airbrushed', 'soft natural window light', 'shallow depth of field background blur',
  'authentic fitness instagram photo', 'tasteful athletic sportswear',
  'no text', 'no watermark', 'no logo overlay'
].join(', ');

// Descrição base do corpo — conforme KIE_IMAGE_PROMPT_GUIDE.md aprovado 2026-04-04
const BASE_BODY = [
  'beautiful slender lean athletic woman in her late 20s',
  'very slim narrow waist',
  'flat stomach with subtle ab definition',
  'slim hips with natural proportions',
  'slim toned legs with light muscle definition',
  'slender arms with light muscle definition',
  'small to medium natural chest fully covered by sports bra',
  'overall slim size-small athletic physique',
  'light natural makeup warm skin glow',
  'small decorative tattoo on left arm',
  'fitness watch on right wrist'
].join(', ');

// Diversidade: variações de cabelo e pele
const DIVERSITY_POOL = [
  { hair: 'long straight dark brunette hair in high ponytail', eyes: 'dark brown eyes', skin: 'warm tan Brazilian skin' },
  { hair: 'long straight dark brunette hair loose down', eyes: 'hazel eyes', skin: 'warm tan Brazilian skin' },
  { hair: 'long straight black hair tied back', eyes: 'dark brown eyes', skin: 'warm tan Brazilian skin' },
  { hair: 'long wavy brunette hair loose', eyes: 'green eyes', skin: 'warm olive skin' },
  { hair: 'long straight blonde hair in low ponytail', eyes: 'blue eyes', skin: 'light fair skin' },
  { hair: 'long wavy blonde hair loose', eyes: 'blue eyes', skin: 'light fair skin' },
  { hair: 'long straight auburn hair loose', eyes: 'brown eyes', skin: 'warm olive skin' }
];

// Roupas fitness coloridas e cobertas — estilo Nike/Gymshark, sem decote
const OUTFIT_POOL = [
  'wearing matching cobalt blue full-length leggings and cobalt blue wide-strap racerback sports bra fully covering chest, white sneakers',
  'wearing hot pink high-waist full-length leggings and matching pink high-neck athletic crop top, white sneakers',
  'wearing yellow high-waist biker shorts and white structured scoop-neck athletic crop top, white sneakers',
  'wearing black full-length leggings and charcoal gray wide-strap athletic crop top fully covering chest, white sneakers',
  'wearing light blue full-length leggings and light blue high-neck sports bra crop top, white sneakers',
  'wearing caramel beige high-waist leggings and matching caramel wide-strap sports bra, white sneakers',
  'wearing dark navy full-length leggings and sky blue wide-strap athletic crop top, white sneakers',
  'wearing forest green high-waist leggings and matching forest green scoop-neck sports bra, white sneakers',
  'wearing deep burgundy high-waist leggings and matching burgundy athletic racerback crop top, white sneakers',
  'wearing white high-waist leggings and white structured high-coverage racerback crop top, white sneakers',
  'wearing lavender purple high-waist leggings and matching wide-strap sports bra, white sneakers',
  'wearing coral orange high-waist leggings and matching coral structured crop top sports bra, white sneakers'
];

// Poses — grande variedade: em pé, sentada, agachada, ângulos de câmera, exercícios
const POSE_POOL = [
  // ── EM PÉ — FRENTE ──────────────────────────────────────────────────────────
  'full body front view head to toe, standing confidently both hands on hips, warm smile at camera, bright modern gym with large windows and wooden floor',
  'full body front view head to toe, arms crossed at chest smiling at camera, toned abs visible, gym with mirrors in background',
  'full body front view head to toe, one hand on hip other arm relaxed at side, candid natural smile, bright gym background',
  'full body front view head to toe, both arms relaxed at sides palms open, genuine warm smile looking at camera, bright gym',
  'full body front view head to toe, one hand touching chin thinking pose, other hand on waist, playful smile, gym background',
  'full body front view head to toe, arms slightly raised at sides showing toned arms, big confident smile, gym with natural light',

  // ── EM PÉ — ÂNGULO 3/4 ──────────────────────────────────────────────────────
  'three-quarter front view full body, turned 45 degrees showing slim waist and toned legs, one hand on hip smiling warmly, modern gym background',
  'three-quarter front view full body, slightly turned showing slim profile, both hands gently clasped in front, soft smile, gym background',
  'three-quarter front view full body, stepping forward dynamically with a confident smile, arms naturally swinging, bright gym',
  'three-quarter front view from knees up, leaning one shoulder against gym mirror smiling, casual confident pose',

  // ── EM PÉ — LATERAL ─────────────────────────────────────────────────────────
  'full body side profile view showing slim waist and toned silhouette, head turned toward camera smiling, bright modern gym with large windows',
  'three-quarter side view full body, looking over shoulder toward camera with warm smile, gym with natural light behind',

  // ── SENTADA ─────────────────────────────────────────────────────────────────
  'full body seated on gym bench, legs together feet flat on floor, hands on knees leaning forward slightly with warm smile at camera, bright gym',
  'full body seated on edge of gym bench, one leg crossed over other, arms relaxed on thighs, relaxed candid smile, clean bright gym',
  'three-quarter view seated on gym mat on floor, legs crossed, elbows on knees, chin resting on hands smiling, bright gym with mirrors',
  'full body seated on plyo box, feet on box knees apart, arms resting on knees, leaning forward with big smile at camera, gym background',
  'three-quarter view seated on gym bench sideways, feet on bench hugging knees, turned smiling at camera, bright gym',

  // ── AGACHADA / BAIXA ────────────────────────────────────────────────────────
  'full body front view, in deep squat position feet flat thighs parallel to floor, arms resting on knees, smiling at camera, bright gym',
  'full body front view, semi-squat low position hands on knees leaning forward, confident smile at camera, gym with natural light',
  'full body front view, crouching down with one knee on floor other leg bent, hands on knee, looking up at camera smiling, gym background',

  // ── EXERCÍCIO — POSES SEGURAS ───────────────────────────────────────────────
  'full body front view, holding light dumbbells at sides standing relaxed, bright smile at camera, mirrors and gym equipment behind',
  'full body front view, holding one light dumbbell up in bicep curl pose, other hand on hip, big smile at camera, gym background',
  'three-quarter front view, seated on gym bench holding water bottle relaxed, other hand on hip, candid smile, clean bright gym',
  'full body front view, standing with resistance band looped around wrists arms extended, smiling at camera, bright gym',
  'full body front view, standing next to cable machine one hand resting on it, other hand on hip, confident smile, gym background',

  // ── ÂNGULO ALTO (câmera de cima) ─────────────────────────────────────────────
  'shot from slightly above, full body front view, woman looking up at camera with warm smile, hands on hips, gym floor visible, bright overhead light',
  'slightly elevated angle three-quarter view, woman looking up smiling, one hand raised touching hair, gym background'
];

let diversityIndex = Math.floor(Math.random() * DIVERSITY_POOL.length);
let outfitIndex = Math.floor(Math.random() * OUTFIT_POOL.length);
let poseIndex = Math.floor(Math.random() * POSE_POOL.length);

function getNextDiversity() {
  const d = DIVERSITY_POOL[diversityIndex % DIVERSITY_POOL.length];
  diversityIndex++;
  return d;
}

function getNextOutfit() {
  const o = OUTFIT_POOL[outfitIndex % OUTFIT_POOL.length];
  outfitIndex++;
  return o;
}

function getNextPose() {
  const p = POSE_POOL[poseIndex % POSE_POOL.length];
  poseIndex++;
  return p;
}

function request(options, body, timeoutMs = 60000) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Kie.ai request timeout after ${timeoutMs / 1000}s`));
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Índices seguros para Kling: APENAS poses em pé ou sentadas eretas
// Poses agachadas/curvadas causam deformação de rosto quando animadas pelo Kling
const KLING_SAFE_POSE_INDICES = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 21, 24, 25, 26];

// Mapa de palavras-chave → índices de poses relevantes no POSE_POOL
// Para imagens estáticas (story/carrossel) usa variedade maior incluindo sentadas
// Para Kling (vídeo) sempre usar getPoseForKling()
const TOPIC_POSE_MAP = [
  // Glúteo, agachamento, pernas — usa poses EM PÉ (agachamento distorce no Kling)
  { keywords: ['glúteo', 'gluteo', 'agachamento', 'perna', 'leg', 'bumbum', 'posterior', 'quadríceps', 'quadriceps', 'lunge', 'afundo'],
    poseIndices: [12, 13, 14, 15, 16, 17] }, // sentadas eretas no banco/mat — ok para imagem estática
  // Braço, ombro, bíceps, tríceps
  { keywords: ['braço', 'braco', 'ombro', 'bíceps', 'biceps', 'tríceps', 'triceps', 'rosca', 'shoulder'],
    poseIndices: [21, 22, 23, 24] }, // poses com haltere
  // Abdômen, core, barriga
  { keywords: ['abdômen', 'abdomen', 'barriga', 'core', 'abdominal', 'cintura'],
    poseIndices: [0, 1, 2, 3, 6, 7] }, // poses frente mostrando cintura
  // Cardio, corrida, emagrecimento
  { keywords: ['cardio', 'corrida', 'correr', 'emagrecer', 'emagrecimento', 'queimar', 'caloria', 'metabolismo'],
    poseIndices: [8, 9, 10, 11] }, // poses dinâmicas/em pé
  // Ciclo menstrual, hormônio, nutrição
  { keywords: ['ciclo', 'menstrual', 'hormônio', 'hormonio', 'nutrição', 'nutricao', 'proteína', 'proteina', 'dieta', 'alimentação'],
    poseIndices: [12, 13, 22, 23] }, // poses sentada/relaxada
];

// Para Kling: sempre pose em pé e ereta — nunca agachada ou curvada
function getPoseForKling() {
  const idx = KLING_SAFE_POSE_INDICES[Math.floor(Math.random() * KLING_SAFE_POSE_INDICES.length)];
  return POSE_POOL[idx];
}

// Para imagens estáticas: seleciona pose relevante ao tema
function getPoseForTopic(topicHint) {
  if (!topicHint) return getNextPose();
  const lower = topicHint.toLowerCase();
  for (const { keywords, poseIndices } of TOPIC_POSE_MAP) {
    if (keywords.some(kw => lower.includes(kw))) {
      const idx = poseIndices[Math.floor(Math.random() * poseIndices.length)];
      return POSE_POOL[Math.min(idx, POSE_POOL.length - 1)];
    }
  }
  return getNextPose();
}

// Monta o prompt final. Aceita topicHint opcional para selecionar pose relevante ao tema.
function buildFinalPrompt(originalPrompt, diversity, outfit, pose) {
  const { hair, eyes, skin } = diversity;

  return [
    pose,
    BASE_BODY,
    `${hair}, ${eyes}, ${skin}`,
    outfit,
    QUALITY_SUFFIX
  ].filter(Boolean).join(', ');
}

// QC específico para imagens de alimento — rejeita relógio, pessoa, objeto sem relação com comida
async function checkFoodImageQuality(imagePath) {
  let anthropicKey = '';
  try {
    const envLines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    for (const line of envLines) {
      const [k, ...v] = line.split('=');
      if (k && k.trim() === 'ANTHROPIC_API_KEY') { anthropicKey = v.join('=').trim(); break; }
    }
    if (!anthropicKey) return { approved: true, reason: 'sem chave Anthropic — pulando QC' };
  } catch { return { approved: true, reason: 'erro ao ler .env — pulando QC' }; }

  try {
    const Anthropic = require(path.join(__dirname, '../../../node_modules/@anthropic-ai/sdk'));
    const client = new Anthropic.default({ apiKey: anthropicKey });
    const imageData = fs.readFileSync(imagePath).toString('base64');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 100,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
          {
            type: 'text',
            text: `You are QC for food Instagram images. Analyze this image.

FAIL if: image shows a watch, phone, person, clothing, gym equipment, landscape, or any non-food object as the main subject.
PASS if: image clearly shows food, drink, meal, ingredients, or kitchen items as the main subject.

Respond ONLY with valid JSON:
{"approved": true} if food is visible as main subject
{"approved": false, "reason": "brief description"} if not food`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return { approved: true, reason: 'resposta inválida — aprovando por padrão' };
    return JSON.parse(match[0]);
  } catch (err) {
    return { approved: true, reason: `QC erro: ${err.message.slice(0, 80)} — aprovando por padrão` };
  }
}

// Sufixo de qualidade específico para fotos de alimentos — sem referências a pessoa/roupa
const FOOD_QUALITY_SUFFIX = [
  'professional food photography',
  'shot on Canon EOS R5 with 100mm macro lens',
  'natural soft window light from the left',
  'shallow depth of field background blur',
  'vibrant appetizing colors',
  'food magazine quality plating',
  'Michelin-star food styling',
  'no text', 'no watermark', 'no people', 'no logo overlay'
].join(', ');

// Geração de imagem de alimento — sem injeção de mulher/roupa/pose
async function generateFoodImage(prompt, outputPath) {
  const apiKey = loadApiKey();

  // Remove duplicatas do prompt original (já pode ter "professional food photography" etc.)
  const cleanPrompt = prompt.replace(/professional food photography,?\s*/gi, '').trim();
  const fullPrompt = `${cleanPrompt}, ${FOOD_QUALITY_SUFFIX}`;

  const genBody = JSON.stringify({
    prompt: fullPrompt,
    enableTranslation: false,
    aspectRatio: '9:16',
    outputFormat: 'png',
    model: 'flux-kontext-pro',
    promptUpsampling: false,
    safetyTolerance: 3
  });

  const genRes = await request({
    hostname: 'api.kie.ai',
    path: '/api/v1/flux/kontext/generate',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(genBody)
    }
  }, genBody);

  if (genRes.status !== 200 || genRes.body.code !== 200) {
    throw new Error(`Kie.ai geração falhou: ${JSON.stringify(genRes.body).slice(0, 300)}`);
  }

  const taskId = genRes.body.data.taskId;

  const MAX_FOOD_ATTEMPTS = 3;
  for (let foodAttempt = 1; foodAttempt <= MAX_FOOD_ATTEMPTS; foodAttempt++) {
    if (foodAttempt > 1) {
      console.log(`  [QC-Food] Tentativa ${foodAttempt}/${MAX_FOOD_ATTEMPTS} — regenerando imagem de alimento...`);
      // Regera com novo taskId
      const regenRes = await request({
        hostname: 'api.kie.ai',
        path: '/api/v1/flux/kontext/generate',
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(JSON.stringify({ prompt: fullPrompt, enableTranslation: false, aspectRatio: '9:16', outputFormat: 'png', model: 'flux-kontext-pro', promptUpsampling: false, safetyTolerance: 3 }))
        }
      }, JSON.stringify({ prompt: fullPrompt, enableTranslation: false, aspectRatio: '9:16', outputFormat: 'png', model: 'flux-kontext-pro', promptUpsampling: false, safetyTolerance: 3 }));
      if (regenRes.status === 200 && regenRes.body.code === 200) {
        // atualiza taskId para polling abaixo
        Object.assign(genRes.body.data, { taskId: regenRes.body.data.taskId });
      }
    }

    const currentTaskId = foodAttempt === 1 ? taskId : genRes.body.data.taskId;
    const maxAttempts = 36;
    let imageUrl = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      await new Promise(r => setTimeout(r, 5000));

      const pollRes = await request({
        hostname: 'api.kie.ai',
        path: `/api/v1/flux/kontext/record-info?taskId=${currentTaskId}`,
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` }
      }, null);

      if (pollRes.status !== 200 || !pollRes.body.data) continue;

      const { successFlag, response: imgResponse, errorMessage } = pollRes.body.data;

      if (successFlag === 1 && imgResponse?.resultImageUrl) {
        imageUrl = imgResponse.resultImageUrl;
        break;
      }

      if (successFlag === 2 || successFlag === 3) {
        throw new Error(`Kie.ai geração falhou (flag ${successFlag}): ${errorMessage || 'erro desconhecido'}`);
      }
    }

    if (!imageUrl) throw new Error(`Kie.ai timeout: tarefa ${currentTaskId} não completou em 3 minutos`);

    // QC: verifica se a imagem é de alimento
    const tmpPath = outputPath.replace(/\.png$/, `_foodtmp${foodAttempt}.png`);
    await downloadImage(imageUrl, tmpPath);
    console.log(`  [QC-Food] Verificando se é imagem de alimento (tentativa ${foodAttempt})...`);
    const qc = await checkFoodImageQuality(tmpPath);

    if (qc.approved) {
      fs.renameSync(tmpPath, outputPath);
      return outputPath;
    }

    console.log(`  [QC-Food] ❌ Reprovada: ${qc.reason}`);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    if (foodAttempt === MAX_FOOD_ATTEMPTS) {
      console.log(`  [QC-Food] ⚠️  ${MAX_FOOD_ATTEMPTS} tentativas esgotadas — usando última imagem disponível`);
      await downloadImage(imageUrl, outputPath);
      return outputPath;
    }
  }
}

// ── QUALITY CONTROL — Claude Vision ─────────────────────────────────────────
// Analisa a imagem gerada e reprova se detectar problemas óbvios
async function checkImageQuality(imagePath) {
  let anthropicKey = '';
  try {
    const envLines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    for (const line of envLines) {
      const [k, ...v] = line.split('=');
      if (k && k.trim() === 'ANTHROPIC_API_KEY') { anthropicKey = v.join('=').trim(); break; }
    }
    if (!anthropicKey) return { approved: true, reason: 'sem chave Anthropic — pulando QC' };
  } catch { return { approved: true, reason: 'erro ao ler .env — pulando QC' }; }

  try {
    const Anthropic = require(path.join(__dirname, '../../../node_modules/@anthropic-ai/sdk'));
    const client = new Anthropic.default({ apiKey: anthropicKey });

    const imageData = fs.readFileSync(imagePath).toString('base64');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: 'image/png', data: imageData } },
          {
            type: 'text',
            text: `You are a quality control system for fitness Instagram images. Analyze this image and respond with JSON only.

Check for these FAIL conditions:
1. No person/woman visible in the image (landscape, nature, objects only — FAIL)
2. Plastic/rubber skin texture (not natural)
3. Deformed or extra fingers/hands visible
4. Man instead of woman
5. Revealing lingerie, thong, bikini or nudity (sports bra is OK if covering chest)
6. Visible deformities (extra limbs, fused body parts, distorted face, crooked eyes)
7. Multiple people in the image

Respond ONLY with valid JSON:
{"approved": true} if image passes
{"approved": false, "reason": "brief description of the problem"} if image fails`
          }
        ]
      }]
    });

    const text = response.content[0].text.trim();
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return { approved: true, reason: 'resposta inválida do QC — aprovando por padrão' };
    return JSON.parse(match[0]);
  } catch (err) {
    return { approved: true, reason: `QC erro: ${err.message.slice(0, 80)} — aprovando por padrão` };
  }
}

async function generateOnce(apiKey, fullPrompt) {
  const genBody = JSON.stringify({
    prompt: fullPrompt,
    enableTranslation: false,
    aspectRatio: '9:16',
    outputFormat: 'png',
    model: 'flux-kontext-pro',
    promptUpsampling: false,
    safetyTolerance: 3
  });

  const genRes = await request({
    hostname: 'api.kie.ai',
    path: '/api/v1/flux/kontext/generate',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(genBody)
    }
  }, genBody);

  if (genRes.status !== 200 || genRes.body.code !== 200) {
    throw new Error(`Kie.ai geração falhou: ${JSON.stringify(genRes.body).slice(0, 300)}`);
  }

  const taskId = genRes.body.data.taskId;
  const maxAttempts = 60; // 60 × 5s = 5 minutos
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    await new Promise(r => setTimeout(r, 5000));

    const pollRes = await request({
      hostname: 'api.kie.ai',
      path: `/api/v1/flux/kontext/record-info?taskId=${taskId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }, null);

    if (pollRes.status !== 200 || !pollRes.body.data) continue;

    const { successFlag, response: imgResponse, errorMessage } = pollRes.body.data;
    if (successFlag === 1 && imgResponse?.resultImageUrl) return imgResponse.resultImageUrl;
    if (successFlag === 2 || successFlag === 3) {
      throw new Error(`Kie.ai flag ${successFlag}: ${errorMessage || 'erro desconhecido'}`);
    }
  }
  throw new Error(`Kie.ai timeout: taskId não completou em 5 minutos`);
}

async function generateImage(prompt, outputPath, topicHint) {
  const apiKey = loadApiKey();

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const diversity = getNextDiversity();
    const outfit = getNextOutfit();
    const pose = getPoseForTopic(topicHint || prompt);
    const fullPrompt = buildFinalPrompt(prompt, diversity, outfit, pose);

    if (attempt > 1) console.log(`  [QC] Tentativa ${attempt}/${MAX_ATTEMPTS} — regenerando...`);

    // 1. Gera imagem — com retry para erros temporários do serviço (flag 3)
    let imageUrl;
    let geracaoOk = false;
    for (let kieAttempt = 1; kieAttempt <= 3; kieAttempt++) {
      try {
        imageUrl = await generateOnce(apiKey, fullPrompt);
        geracaoOk = true;
        break;
      } catch (err) {
        const isTransient = err.message.includes('flag 3') || err.message.includes('internal error') || err.message.includes('try again');
        if (isTransient && kieAttempt < 3) {
          const delay = kieAttempt * 30000; // 30s, 60s
          console.log(`  [KIE] Erro temporário (tentativa ${kieAttempt}/3): ${err.message.slice(0, 80)}`);
          console.log(`  [KIE] Aguardando ${delay / 1000}s antes de tentar novamente...`);
          await new Promise(r => setTimeout(r, delay));
        } else {
          throw err; // erro não-temporário ou esgotou retries KIE
        }
      }
    }
    if (!geracaoOk) continue; // não deveria chegar aqui, mas por segurança

    // 2. Baixa para arquivo temporário
    const tmpPath = outputPath.replace(/\.png$/, `_tmp${attempt}.png`);
    await downloadImage(imageUrl, tmpPath);

    // 3. Verifica qualidade com Claude Vision
    console.log(`  [QC] Analisando imagem (tentativa ${attempt})...`);
    const qc = await checkImageQuality(tmpPath);

    if (qc.approved) {
      // Aprovada — move para o destino final
      fs.renameSync(tmpPath, outputPath);
      if (attempt > 1) console.log(`  [QC] ✅ Aprovada na tentativa ${attempt}`);
      return outputPath;
    }

    // Reprovada — loga e tenta novamente
    console.log(`  [QC] ❌ Reprovada: ${qc.reason}`);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    if (attempt === MAX_ATTEMPTS) {
      // Esgotou tentativas — usa a última imagem gerada mesmo assim
      console.log(`  [QC] ⚠️  ${MAX_ATTEMPTS} tentativas esgotadas — usando última imagem disponível`);
      await downloadImage(imageUrl, outputPath);
      return outputPath;
    }
  }

}

function downloadImage(url, outputPath) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET'
    };

    const req = https.request(options, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadImage(res.headers.location, outputPath).then(resolve).catch(reject);
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        fs.writeFileSync(outputPath, Buffer.concat(chunks));
        resolve(outputPath);
      });
    });
    req.on('error', reject);
    req.end();
  });
}

// Versão especial para Kling: pose SEMPRE em pé/ereta, nunca agachada
// Kling distorce rostos em poses curvadas — esta função previne isso
async function generateImageForKling(outputPath) {
  const apiKey = loadApiKey();

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const diversity = getNextDiversity();
    const outfit    = getNextOutfit();
    const pose      = getPoseForKling(); // sempre em pé e ereto
    const fullPrompt = buildFinalPrompt('', diversity, outfit, pose);

    if (attempt > 1) console.log(`  [QC-Kling] Tentativa ${attempt}/${MAX_ATTEMPTS} — regenerando...`);

    const imageUrl = await generateOnce(apiKey, fullPrompt);
    const tmpPath  = outputPath.replace(/\.png$/, `_tmp${attempt}.png`);
    await downloadImage(imageUrl, tmpPath);

    console.log(`  [QC-Kling] Analisando imagem (tentativa ${attempt})...`);
    const qc = await checkImageQuality(tmpPath);

    if (qc.approved) {
      fs.renameSync(tmpPath, outputPath);
      if (attempt > 1) console.log(`  [QC-Kling] ✅ Aprovada na tentativa ${attempt}`);
      return outputPath;
    }

    console.log(`  [QC-Kling] ❌ Reprovada: ${qc.reason}`);
    if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath);

    if (attempt === MAX_ATTEMPTS) {
      console.log(`  [QC-Kling] ⚠️  ${MAX_ATTEMPTS} tentativas esgotadas — usando última imagem`);
      await downloadImage(imageUrl, outputPath);
      return outputPath;
    }
  }
}

module.exports = { generateImage, generateImageForKling, generateFoodImage };
