/**
 * kling.cjs — Cliente Kling AI para geração de vídeos Image-to-Video
 *
 * Fluxo:
 *   1. Recebe uma imagem PNG (gerada pelo Kie.ai) + prompt de movimento
 *   2. Envia para a API do Kling (image2video)
 *   3. Faz polling até o vídeo ficar pronto (~2-5 min)
 *   4. Baixa o MP4 e salva no destino
 *
 * Configuração no .env:
 *   KLING_ACCESS_KEY=seu-access-key-id
 *   KLING_SECRET_KEY=seu-access-key-secret
 */

'use strict';

const https = require('https');
const fs    = require('fs');
const path  = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

// ── Carrega credenciais ────────────────────────────────────────────────────────
function loadCredentials() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim()) env[k.trim()] = v.join('=').trim();
  }
  const accessKey = env['KLING_ACCESS_KEY'];
  const secretKey = env['KLING_SECRET_KEY'];
  if (!accessKey || !secretKey) {
    throw new Error('KLING_ACCESS_KEY e/ou KLING_SECRET_KEY não encontradas no .env');
  }
  return { accessKey, secretKey };
}

// ── JWT para autenticação ──────────────────────────────────────────────────────
// Kling AI usa JWT HS256 com AccessKey + SecretKey
function buildJWT(accessKey, secretKey) {
  const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const now     = Math.floor(Date.now() / 1000);
  const payload = Buffer.from(JSON.stringify({
    iss: accessKey,
    exp: now + 1800, // válido por 30 minutos
    nbf: now - 5
  })).toString('base64url');

  const crypto  = require('crypto');
  const sig     = crypto
    .createHmac('sha256', secretKey)
    .update(`${header}.${payload}`)
    .digest('base64url');

  return `${header}.${payload}.${sig}`;
}

// ── HTTP helper ────────────────────────────────────────────────────────────────
function httpRequest(options, body) {
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

function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const options = {
      hostname: parsedUrl.hostname,
      path: parsedUrl.pathname + parsedUrl.search,
      method: 'GET',
      headers: { 'User-Agent': 'Mozilla/5.0' }
    };
    const req = https.request(options, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        return downloadFile(res.headers.location, outputPath).then(resolve).catch(reject);
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

// ── Prompt de movimento padrão ─────────────────────────────────────────────────
// Prompts que funcionam bem para fitness Instagram — movimento natural e cinematic
const MOVEMENT_PROMPTS = [
  'woman smiling warmly at camera with subtle confident breathing, hair gently swaying, soft gym light through windows, smooth cinematic motion, realistic 4K',
  'subtle weight shift and natural breathing movement, warm smile, gym environment with soft natural light, graceful feminine motion, cinematic realism',
  'gentle head tilt and warm smile at camera, slight shoulder movement, bright gym background with bokeh, natural organic motion, ultra realistic',
  'confident posture with natural breathing and micro-movements, direct eye contact and genuine smile, gym setting alive with soft light, cinematic 4K motion',
  'relaxed natural movement, woman shifting slightly while maintaining eye contact with camera, gym background gently in focus, smooth realistic animation'
];

let movementIndex = Math.floor(Math.random() * MOVEMENT_PROMPTS.length);

function getNextMovementPrompt() {
  const p = MOVEMENT_PROMPTS[movementIndex % MOVEMENT_PROMPTS.length];
  movementIndex++;
  return p;
}

// ── Geração Image-to-Video ─────────────────────────────────────────────────────
/**
 * Gera um vídeo de 10 segundos a partir de uma imagem PNG.
 *
 * @param {string} imagePath  - Caminho absoluto da imagem PNG de entrada
 * @param {string} outputPath - Caminho absoluto onde salvar o MP4
 * @param {string} [movementPrompt] - Prompt de movimento customizado (opcional)
 * @returns {Promise<string>} - outputPath quando concluído
 */
async function generateVideo(imagePath, outputPath, movementPrompt) {
  const { accessKey, secretKey } = loadCredentials();
  const jwt = buildJWT(accessKey, secretKey);

  // Converte imagem para base64 puro (sem prefixo data URI — Kling não aceita)
  const imageBase64 = fs.readFileSync(imagePath).toString('base64');

  const prompt = movementPrompt || getNextMovementPrompt();

  // ── 1. Cria a tarefa de geração ──────────────────────────────────────────────
  const reqBody = JSON.stringify({
    model_name: 'kling-v1',          // modelo padrão estável
    image: imageBase64,
    prompt: prompt,
    negative_prompt: 'blurry, distorted, low quality, artifacts, text, watermark, logo, duplicate person, extra limbs',
    cfg_scale: 0.5,                  // 0.0-1.0 — 0.5 equilibra fidelidade e movimento
    mode: 'std',                     // 'std' (padrão) ou 'pro' (mais lento, mais detalhado)
    duration: 10                     // 5 ou 10 segundos
  });

  const createRes = await httpRequest({
    hostname: 'api.klingai.com',
    path: '/v1/videos/image2video',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${jwt}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqBody)
    }
  }, reqBody);

  if (createRes.status !== 200 || createRes.body.code !== 0) {
    throw new Error(`Kling AI criação falhou (HTTP ${createRes.status}): ${JSON.stringify(createRes.body).slice(0, 400)}`);
  }

  const taskId = createRes.body.data?.task_id;
  if (!taskId) throw new Error(`Kling AI: task_id não retornado — resposta: ${JSON.stringify(createRes.body).slice(0, 300)}`);

  console.log(`  [Kling] Tarefa criada: ${taskId} | Prompt: "${prompt.slice(0, 60)}..."`);

  // ── 2. Polling até vídeo ficar pronto ────────────────────────────────────────
  // Kling demora ~2-5 min para 10s. Polling a cada 15s, máximo 30 tentativas (7.5 min).
  const MAX_POLLS  = 30;
  const POLL_DELAY = 15000; // 15 segundos

  for (let attempt = 1; attempt <= MAX_POLLS; attempt++) {
    await new Promise(r => setTimeout(r, POLL_DELAY));

    const pollRes = await httpRequest({
      hostname: 'api.klingai.com',
      path: `/v1/videos/image2video/${taskId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${jwt}` }
    }, null);

    if (pollRes.status !== 200 || pollRes.body.code !== 0) {
      console.log(`  [Kling] Poll ${attempt}/${MAX_POLLS}: erro HTTP ${pollRes.status} — tentando novamente...`);
      continue;
    }

    const task   = pollRes.body.data;
    const status = task?.task_status;

    if (status === 'succeed') {
      // Pega URL do vídeo gerado
      const videoUrl = task?.task_result?.videos?.[0]?.url;
      if (!videoUrl) throw new Error('Kling AI: vídeo concluído mas URL não encontrada na resposta');

      console.log(`  [Kling] ✅ Vídeo pronto (tentativa ${attempt}) — baixando...`);
      await downloadFile(videoUrl, outputPath);
      console.log(`  [Kling] ✅ Salvo em: ${outputPath}`);
      return outputPath;
    }

    if (status === 'failed') {
      const reason = task?.task_status_msg || 'motivo desconhecido';
      throw new Error(`Kling AI: geração falhou — ${reason}`);
    }

    // Status: 'submitted' ou 'processing' — ainda processando
    const elapsed = Math.round((attempt * POLL_DELAY) / 1000);
    console.log(`  [Kling] Poll ${attempt}/${MAX_POLLS}: ${status} (${elapsed}s decorridos)...`);
  }

  throw new Error(`Kling AI timeout: tarefa ${taskId} não completou em ${(MAX_POLLS * POLL_DELAY) / 60000} minutos`);
}

module.exports = { generateVideo, getNextMovementPrompt };
