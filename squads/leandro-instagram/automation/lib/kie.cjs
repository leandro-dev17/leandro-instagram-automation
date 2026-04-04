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

// Sufixo de qualidade
const QUALITY_SUFFIX = [
  'ultra photorealistic', 'candid fitness photography',
  'natural skin texture', 'soft natural lighting through large gym windows',
  'editorial fitness instagram style', '4K resolution',
  'no text', 'no watermark', 'no logo overlay'
].join(', ');

// Descrição base do corpo — baseada nas fotos de referência da personal trainer
// Lean, tonificada, proporcional — NÃO exagerada, NÃO bodybuilder, NÃO sexualizada
const BASE_BODY = [
  'beautiful slender lean athletic woman in her late 20s',
  'very slim narrow waist',
  'flat stomach with subtle ab definition',
  'slim hips with natural proportions',
  'slim toned legs with light muscle definition',
  'slender arms with light muscle definition',
  'small to medium natural chest size',
  'overall slim size-small athletic physique',
  'light natural makeup',
  'tattoo sleeve on left arm',
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

// Roupas baseadas nas referências — conjuntos fitness coloridos e cobertos, estilo Nike/Gymshark
const OUTFIT_POOL = [
  'wearing matching cobalt blue leggings and blue racerback sports bra crop top, white sneakers',
  'wearing hot pink high-waist full-length leggings and matching pink bandeau sports bra, white sneakers',
  'wearing yellow high-waist bike shorts and white spaghetti-strap crop top, white sneakers',
  'wearing black full-length leggings and strappy black racerback sports bra, white sneakers',
  'wearing light blue full-length leggings and light blue sports bra with wide straps, white sneakers',
  'wearing nude beige high-waist leggings and matching beige scoop-neck sports bra, white sneakers',
  'wearing dark navy leggings and baby blue wide-strap sports bra, white sneakers',
  'wearing forest green high-waist leggings and matching green sports bra, white sneakers',
  'wearing burgundy high-waist leggings and matching burgundy sports bra crop top, white sneakers',
  'wearing white high-waist leggings and white racerback sports bra, white sneakers'
];

// Poses — frente, 3/4 e lateral. Sem poses de costas nuas ou muito sexualizadas
const POSE_POOL = [
  // Corpo inteiro — frente
  'full body front view head to toe, standing confidently both hands on hips, warm smile at camera, bright modern gym with large windows and wooden floor',
  'full body front view head to toe, walking toward camera with relaxed confident smile, arms naturally at sides, bright gym background',
  'full body front view head to toe, arms crossed at chest smiling at camera, toned abs visible, gym with mirrors in background',
  'full body front view head to toe, one hand on hip other hand adjusting ponytail, candid smile, bright gym',
  // 3/4 frente
  'three-quarter front view full body, turned 45 degrees showing slim waist, one hand on hip smiling warmly, modern gym background',
  'three-quarter front view waist up, leaning slightly forward on gym railing smiling, flat stomach visible, gym with natural light',
  // Lateral
  'full body side profile view showing slim waist and toned silhouette, looking slightly toward camera with a smile, bright modern gym',
  'three-quarter body side view hands naturally at sides showing slim profile, warm candid expression, gym with large windows',
  // Exercício — pose de frente visível
  'full body front view, holding light dumbbells at sides standing relaxed, bright smile at camera, mirrors and gym equipment behind',
  'full body front view, seated on gym bench with arms resting on knees leaning forward smiling at camera, clean bright gym',
  'full body front view, standing at cable machine facing camera with rope handles relaxed at sides, confident smile, gym background'
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

function request(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

// Monta o prompt final com corpo base, diversidade, roupa e pose
function buildFinalPrompt(originalPrompt, diversity, outfit, pose) {
  // Extrai apenas o contexto do exercício/cenário do prompt original
  // (ignora descrições de corpo/roupa que já temos nos pools)
  let context = originalPrompt
    .replace(/Brazilian fitness woman[^,]*/gi, '')
    .replace(/fitness woman[^,]*/gi, '')
    .replace(/athletic build[^,]*/gi, '')
    .replace(/slim athletic[^,]*/gi, '')
    .replace(/wearing[^,]*/gi, '')
    .replace(/leggings[^,]*/gi, '')
    .replace(/sports bra[^,]*/gi, '')
    .replace(/,\s*,/g, ',')
    .replace(/^,\s*/, '')
    .trim();

  // Corrige exercícios com barbell que geram mãos defeituosas
  context = context
    .replace(/gripping barbell/gi, 'with hands lightly resting on bar')
    .replace(/performing squat with (heavy )?barbell/gi, 'barbell resting on upper traps')
    .replace(/Romanian deadlift with (heavy )?barbell/gi, 'holding dumbbells at sides');

  const { hair, eyes, skin } = diversity;

  return [
    pose,
    BASE_BODY,
    `${hair}, ${eyes}, ${skin}`,
    outfit,
    context,
    'modern gym with large floor-to-ceiling windows, tropical outdoor view, wooden floor',
    QUALITY_SUFFIX
  ].filter(Boolean).join(', ');
}

// Geração de imagem de alimento — sem injeção de mulher/roupa/pose
async function generateFoodImage(prompt, outputPath) {
  const apiKey = loadApiKey();

  const fullPrompt = `${prompt}, ${QUALITY_SUFFIX}`;

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

  const maxAttempts = 36;
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

    if (successFlag === 1 && imgResponse?.resultImageUrl) {
      await downloadImage(imgResponse.resultImageUrl, outputPath);
      return outputPath;
    }

    if (successFlag === 2 || successFlag === 3) {
      throw new Error(`Kie.ai geração falhou (flag ${successFlag}): ${errorMessage || 'erro desconhecido'}`);
    }
  }

  throw new Error(`Kie.ai timeout: tarefa ${taskId} não completou em 3 minutos`);
}

async function generateImage(prompt, outputPath) {
  const apiKey = loadApiKey();

  const diversity = getNextDiversity();
  const outfit = getNextOutfit();
  const pose = getNextPose();
  const fullPrompt = buildFinalPrompt(prompt, diversity, outfit, pose);

  // Detecta orientação pelo outputPath para escolher aspect ratio correto
  // Posts feed (post-*.png) → 4:3 landscape ou 9:16 portrait
  // Reels (reel-*.png) → 9:16
  const fileName = path.basename(outputPath);
  const aspectRatio = fileName.startsWith('reel') ? '9:16' : '9:16';

  // 1. Cria tarefa de geração
  const genBody = JSON.stringify({
    prompt: fullPrompt,
    enableTranslation: false,
    aspectRatio,
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

  // 2. Polling até completar (máx 3 minutos, intervalo 5s)
  const maxAttempts = 36;
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

    if (successFlag === 1 && imgResponse?.resultImageUrl) {
      // 3. Baixa e salva a imagem
      await downloadImage(imgResponse.resultImageUrl, outputPath);
      return outputPath;
    }

    if (successFlag === 2 || successFlag === 3) {
      throw new Error(`Kie.ai geração falhou (flag ${successFlag}): ${errorMessage || 'erro desconhecido'}`);
    }
    // successFlag === 0: ainda gerando, continua polling
  }

  throw new Error(`Kie.ai timeout: tarefa ${taskId} não completou em 3 minutos`);
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

module.exports = { generateImage, generateFoodImage };
