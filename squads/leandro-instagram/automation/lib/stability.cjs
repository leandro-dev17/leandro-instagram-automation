/**
 * stability.cjs — Cliente Stability AI para geração de imagens
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

function loadApiKey() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() === 'STABILITY_API_KEY') return v.join('=').trim();
  }
  throw new Error('STABILITY_API_KEY não encontrada no arquivo .env');
}

const REALISTIC_SUFFIX = [
  'hyperrealistic', 'photorealistic', '8K UHD', 'ultra detailed',
  'shot on Canon EOS R5', '85mm f/1.4 lens', 'shallow depth of field',
  'natural skin texture', 'cinematic lighting', 'professional photography',
  'magazine editorial quality', 'no text', 'no watermark', 'no logo'
].join(', ');

const NEGATIVE_PROMPT = [
  // Qualidade geral
  'cartoon', 'anime', 'illustration', 'CGI', 'plastic skin',
  'artificial look', 'AI-generated look', 'blurry', 'watermark',
  'text', 'logo', 'bad anatomy', 'deformed', 'ugly', 'low quality',
  'overexposed', 'noisy', 'grain', 'unrealistic',
  // Mãos e dedos (principais problemas)
  'deformed hands', 'bad hands', 'extra fingers', 'missing fingers',
  'fused fingers', 'too many fingers', 'mutated hands', 'malformed hands',
  'poorly drawn hands', 'extra limbs', 'missing limbs', 'deformed fingers',
  'long fingers', 'short fingers', 'abnormal wrist', 'deformed wrist',
  'broken wrist', 'bad wrist', 'disfigured hands', 'cloned hands'
].join(', ');

async function generateImage(prompt, outputPath) {
  const apiKey = loadApiKey();
  const fullPrompt = `${prompt}, ${REALISTIC_SUFFIX}`;

  const body = JSON.stringify({
    text_prompts: [
      { text: fullPrompt, weight: 1 },
      { text: NEGATIVE_PROMPT, weight: -1 }
    ],
    cfg_scale: 10,
    height: 1344,
    width: 768,
    samples: 1,
    steps: 50,
    style_preset: 'photographic'
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.stability.ai',
      path: '/v1/generation/stable-diffusion-xl-1024-v1-0/text-to-image',
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode === 200) {
          const b64 = JSON.parse(data).artifacts?.[0]?.base64;
          if (!b64) return reject(new Error('Nenhuma imagem retornada pela API'));
          fs.writeFileSync(outputPath, Buffer.from(b64, 'base64'));
          resolve(outputPath);
        } else {
          reject(new Error(`Stability AI erro ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { generateImage };
