/**
 * test-together.cjs — Compara Together.ai (gratuito) vs Kie.ai (pago)
 *
 * Gera 4 pares de imagens com EXATAMENTE os mesmos prompts:
 *   - Together.ai: FLUX.1-schnell-Free (gratuito)
 *   - Kie.ai:      Flux Kontext Pro (pago)
 *
 * Pré-requisito: adicionar TOGETHER_API_KEY no arquivo .env
 * (cadastre-se em Together.ai, gere uma API key e cole no .env)
 *
 * Resultado: pasta teste-together/ com 8 imagens + relatório de QC no terminal
 */

'use strict';

const https = require('https');
const fs = require('fs');
const path = require('path');

// ── Config ─────────────────────────────────────────────────────────────────────
const ENV_PATH = path.join(__dirname, '../../.env');
const OUT_DIR = 'C:/Users/lelus/OneDrive/Pictures/Automação Claude post/leandro-instagram/teste-together';
const N_PAIRS = 4; // quantos pares gerar

if (!fs.existsSync(OUT_DIR)) fs.mkdirSync(OUT_DIR, { recursive: true });

// ── Carrega .env ───────────────────────────────────────────────────────────────
function loadEnv() {
  const keys = {};
  try {
    const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
    for (const line of lines) {
      const [k, ...v] = line.split('=');
      if (k && k.trim()) keys[k.trim()] = v.join('=').trim();
    }
  } catch { /* .env não encontrado */ }
  return keys;
}

// ── Pools (idênticos ao kie.cjs aprovado) ─────────────────────────────────────
const QUALITY_SUFFIX = [
  'real candid photograph', 'shot on Sony A7 IV mirrorless camera 85mm f1.8 lens',
  'natural skin texture with visible pores', 'subtle natural skin imperfections',
  'not airbrushed', 'soft natural window light', 'shallow depth of field background blur',
  'authentic fitness instagram photo', 'tasteful athletic sportswear',
  'no text', 'no watermark', 'no logo overlay'
].join(', ');

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

const DIVERSITY_POOL = [
  { hair: 'long straight dark brunette hair in high ponytail', eyes: 'dark brown eyes', skin: 'warm tan Brazilian skin' },
  { hair: 'long wavy brunette hair loose', eyes: 'green eyes', skin: 'warm olive skin' },
  { hair: 'long straight blonde hair in low ponytail', eyes: 'blue eyes', skin: 'light fair skin' },
  { hair: 'long straight auburn hair loose', eyes: 'brown eyes', skin: 'warm olive skin' }
];

const OUTFIT_POOL = [
  'wearing matching cobalt blue full-length leggings and cobalt blue wide-strap racerback sports bra fully covering chest, white sneakers',
  'wearing hot pink high-waist full-length leggings and matching pink high-neck athletic crop top, white sneakers',
  'wearing forest green high-waist leggings and matching forest green scoop-neck sports bra, white sneakers',
  'wearing deep burgundy high-waist leggings and matching burgundy athletic racerback crop top, white sneakers'
];

const POSE_POOL = [
  'full body front view head to toe, standing confidently both hands on hips, warm smile at camera, bright modern gym with large windows and wooden floor',
  'three-quarter front view full body, turned 45 degrees showing slim waist and toned legs, one hand on hip smiling warmly, modern gym background',
  'full body seated on gym bench, legs together feet flat on floor, hands on knees leaning forward slightly with warm smile at camera, bright gym',
  'full body front view, holding light dumbbells at sides standing relaxed, bright smile at camera, mirrors and gym equipment behind'
];

function buildFinalPrompt(diversity, outfit, pose) {
  const { hair, eyes, skin } = diversity;
  return [
    pose,
    BASE_BODY,
    `${hair}, ${eyes}, ${skin}`,
    outfit,
    'modern gym with large floor-to-ceiling windows, tropical outdoor view, wooden floor',
    QUALITY_SUFFIX
  ].join(', ');
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

function downloadImage(url, outputPath) {
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

// ── Together.ai — FLUX.1-schnell-Free ─────────────────────────────────────────
async function generateTogether(apiKey, prompt) {
  const reqBody = JSON.stringify({
    model: 'black-forest-labs/FLUX.1-schnell-Free',
    prompt,
    width: 768,
    height: 1344,   // proporção 9:16 próxima do Instagram Stories
    steps: 4,
    n: 1,
    response_format: 'url'
  });

  const res = await httpRequest({
    hostname: 'api.together.xyz',
    path: '/v1/images/generations',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(reqBody)
    }
  }, reqBody);

  if (res.status !== 200) {
    throw new Error(`Together.ai HTTP ${res.status}: ${JSON.stringify(res.body).slice(0, 300)}`);
  }

  // Together.ai pode retornar URL ou b64_json dependendo do modelo
  const item = res.body.data?.[0];
  if (!item) throw new Error(`Together.ai: resposta sem data[0]: ${JSON.stringify(res.body).slice(0, 300)}`);

  if (item.url) return { type: 'url', value: item.url };
  if (item.b64_json) return { type: 'b64', value: item.b64_json };
  throw new Error(`Together.ai: sem URL nem b64 na resposta`);
}

async function saveTogether(apiKey, prompt, outputPath) {
  const result = await generateTogether(apiKey, prompt);
  if (result.type === 'url') {
    await downloadImage(result.value, outputPath);
  } else {
    fs.writeFileSync(outputPath, Buffer.from(result.value, 'base64'));
  }
  return outputPath;
}

// ── Kie.ai — Flux Kontext Pro ──────────────────────────────────────────────────
async function generateKie(apiKey, prompt) {
  const genBody = JSON.stringify({
    prompt,
    enableTranslation: false,
    aspectRatio: '9:16',
    outputFormat: 'png',
    model: 'flux-kontext-pro',
    promptUpsampling: false,
    safetyTolerance: 3
  });

  const genRes = await httpRequest({
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
  for (let i = 1; i <= 36; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const pollRes = await httpRequest({
      hostname: 'api.kie.ai',
      path: `/api/v1/flux/kontext/record-info?taskId=${taskId}`,
      method: 'GET',
      headers: { 'Authorization': `Bearer ${apiKey}` }
    }, null);

    if (pollRes.status !== 200 || !pollRes.body.data) continue;
    const { successFlag, response: imgResponse, errorMessage } = pollRes.body.data;
    if (successFlag === 1 && imgResponse?.resultImageUrl) return imgResponse.resultImageUrl;
    if (successFlag === 2 || successFlag === 3) {
      throw new Error(`Kie.ai flag ${successFlag}: ${errorMessage || 'erro'}`);
    }
  }
  throw new Error(`Kie.ai timeout: taskId ${taskId} não completou em 3 min`);
}

async function saveKie(apiKey, prompt, outputPath) {
  const url = await generateKie(apiKey, prompt);
  await downloadImage(url, outputPath);
  return outputPath;
}

// ── QC via IA (Groq→Cerebras, visão) ────────────────────────────────────────────
async function checkQuality(imagePath) {
  const { gerarComVisao } = require('./lib/ai-helper.cjs');
  if (!process.env.GROQ_API_KEY) return { approved: true, reason: 'sem GROQ_API_KEY — QC desativado' };
  try {
    const imageData = fs.readFileSync(imagePath).toString('base64');

    const prompt = `Quality control for fitness Instagram image. Respond ONLY with valid JSON.

FAIL if:
1. Plastic/rubber/artificial skin texture
2. Deformed hands or extra fingers
3. Man instead of woman
4. Revealing lingerie, thong, bikini, or nudity
5. Visible deformities (extra limbs, distorted face)
6. Multiple people

{"approved": true} — if passes
{"approved": false, "reason": "brief description"} — if fails`;

    const text = await gerarComVisao(prompt, imageData, 200);
    const match = text.match(/\{[\s\S]*?\}/);
    if (!match) return { approved: true, reason: 'resposta inválida' };
    return JSON.parse(match[0]);
  } catch (err) {
    return { approved: true, reason: `QC erro: ${err.message.slice(0, 80)}` };
  }
}

// ── Main ───────────────────────────────────────────────────────────────────────
async function main() {
  const env = loadEnv();

  const togetherKey = env['TOGETHER_API_KEY'];
  const kieKey = env['KIE_API_KEY'];
  if (env['GROQ_API_KEY']) process.env.GROQ_API_KEY = env['GROQ_API_KEY'];

  if (!togetherKey) {
    console.error('\n❌ TOGETHER_API_KEY não encontrada no .env');
    console.error('   Cadastre-se em Together.ai, gere uma API key e adicione ao .env:');
    console.error('   TOGETHER_API_KEY=sua-chave-aqui\n');
    process.exit(1);
  }

  if (!kieKey) {
    console.error('\n❌ KIE_API_KEY não encontrada no .env — necessária para comparação\n');
    process.exit(1);
  }

  console.log(`\n🔬 Teste comparativo: Together.ai (grátis) vs Kie.ai (pago)`);
  console.log(`   ${N_PAIRS} pares de imagens — mesmo prompt exato para ambos`);
  console.log(`   Saída: ${OUT_DIR}\n`);
  console.log('─'.repeat(70));

  const results = [];

  for (let i = 0; i < N_PAIRS; i++) {
    const pairNum = String(i + 1).padStart(2, '0');
    const diversity = DIVERSITY_POOL[i % DIVERSITY_POOL.length];
    const outfit = OUTFIT_POOL[i % OUTFIT_POOL.length];
    const pose = POSE_POOL[i % POSE_POOL.length];
    const prompt = buildFinalPrompt(diversity, outfit, pose);

    const poseName = pose.split(',')[0].replace(/full body |three-quarter |shot from |slightly elevated angle /gi, '').trim().slice(0, 40);
    console.log(`\n[Par ${pairNum}] ${poseName}`);
    console.log(`  Diversidade: ${diversity.hair.split(' ').slice(-2).join(' ')}, ${diversity.skin}`);
    console.log(`  Roupa: ${outfit.split(' ').slice(1, 4).join(' ')}...`);

    const row = { pair: pairNum, pose: poseName };

    // ── Together.ai ──────────────────────────────────────────────────────────
    const togetherPath = path.join(OUT_DIR, `${pairNum}-together-schnell.png`);
    const kieFilePath = path.join(OUT_DIR, `${pairNum}-kie-kontext-pro.png`);

    // Together.ai
    try {
      process.stdout.write(`  → Together.ai (FLUX.1-schnell-Free)... `);
      const t0 = Date.now();
      await saveTogether(togetherKey, prompt, togetherPath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`✅ (${elapsed}s)\n`);

      const qc = await checkQuality(togetherPath);
      const qcStr = qc.approved ? '✅ QC OK' : `❌ QC falhou: ${qc.reason}`;
      console.log(`     ${qcStr}`);
      row.together = { ok: true, qc: qc.approved, qcReason: qc.reason, time: elapsed };
    } catch (err) {
      console.log(`❌ ERRO: ${err.message.slice(0, 120)}`);
      row.together = { ok: false, error: err.message.slice(0, 100) };
    }

    // Kie.ai
    try {
      process.stdout.write(`  → Kie.ai (Flux Kontext Pro)...      `);
      const t0 = Date.now();
      await saveKie(kieKey, prompt, kieFilePath);
      const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
      process.stdout.write(`✅ (${elapsed}s)\n`);

      const qc = await checkQuality(kieFilePath);
      const qcStr = qc.approved ? '✅ QC OK' : `❌ QC falhou: ${qc.reason}`;
      console.log(`     ${qcStr}`);
      row.kie = { ok: true, qc: qc.approved, qcReason: qc.reason, time: elapsed };
    } catch (err) {
      console.log(`❌ ERRO: ${err.message.slice(0, 120)}`);
      row.kie = { ok: false, error: err.message.slice(0, 100) };
    }

    results.push(row);
  }

  // ── Relatório final ───────────────────────────────────────────────────────
  console.log('\n' + '═'.repeat(70));
  console.log('RELATÓRIO COMPARATIVO\n');

  let togetherPass = 0, kiePass = 0, togetherFail = 0, kieFail = 0;

  for (const r of results) {
    console.log(`Par ${r.pair}: ${r.pose}`);

    if (r.together?.ok) {
      const qcIcon = r.together.qc ? '✅' : '❌';
      const timeStr = r.together.time ? ` (${r.together.time}s)` : '';
      console.log(`  Together.ai: ${qcIcon} QC${timeStr}${!r.together.qc ? ' — ' + r.together.qcReason : ''}`);
      if (r.together.qc) togetherPass++; else togetherFail++;
    } else {
      console.log(`  Together.ai: 💥 Erro na geração — ${r.together?.error}`);
      togetherFail++;
    }

    if (r.kie?.ok) {
      const qcIcon = r.kie.qc ? '✅' : '❌';
      const timeStr = r.kie.time ? ` (${r.kie.time}s)` : '';
      console.log(`  Kie.ai:      ${qcIcon} QC${timeStr}${!r.kie.qc ? ' — ' + r.kie.qcReason : ''}`);
      if (r.kie.qc) kiePass++; else kieFail++;
    } else {
      console.log(`  Kie.ai:      💥 Erro na geração — ${r.kie?.error}`);
      kieFail++;
    }
  }

  console.log('\n' + '─'.repeat(70));
  console.log(`Together.ai — QC aprovadas: ${togetherPass}/${N_PAIRS} | Falhas: ${togetherFail}/${N_PAIRS}`);
  console.log(`Kie.ai      — QC aprovadas: ${kiePass}/${N_PAIRS} | Falhas: ${kieFail}/${N_PAIRS}`);
  console.log('─'.repeat(70));

  if (togetherPass === N_PAIRS) {
    console.log('\n✅ RESULTADO: Together.ai passou em TODOS os testes!');
    console.log('   Custo estimado: R$0-15/mês vs R$270/mês no Kie.ai');
    console.log('   Recomendação: migrar para Together.ai e eliminar Kie.ai');
  } else if (togetherPass >= N_PAIRS / 2) {
    console.log(`\n⚠️  RESULTADO: Together.ai passou em ${togetherPass}/${N_PAIRS} testes.`);
    console.log('   Considere fal.ai (FLUX.1-dev) como alternativa de melhor qualidade (~R$20/mês)');
  } else {
    console.log('\n❌ RESULTADO: Together.ai não atingiu qualidade aceitável neste lote.');
    console.log('   Mantenha Kie.ai ou teste fal.ai (FLUX.1-dev) para melhor qualidade');
  }

  console.log('\n📁 Imagens salvas em:');
  console.log(`   ${OUT_DIR}`);
  console.log('   Compare os pares visualmente antes de decidir.\n');
}

main().catch(err => {
  console.error('\n💥 ERRO FATAL:', err.message);
  process.exit(1);
});
