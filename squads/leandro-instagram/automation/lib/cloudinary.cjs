/**
 * cloudinary.cjs — Upload de imagens para Cloudinary (URL pública para Instagram API)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ENV_PATH = path.join(__dirname, '../../.env');

function loadCredentials() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k) env[k.trim()] = v.join('=').trim();
  }
  if (!env.CLOUDINARY_CLOUD_NAME) throw new Error('CLOUDINARY_CLOUD_NAME não encontrada no .env');
  if (!env.CLOUDINARY_API_KEY)    throw new Error('CLOUDINARY_API_KEY não encontrada no .env');
  if (!env.CLOUDINARY_API_SECRET) throw new Error('CLOUDINARY_API_SECRET não encontrada no .env');
  return env;
}

const HTTP_TIMEOUT_MS = 60000; // 60s para uploads (arquivos maiores)

function withTimeout(req, label) {
  req.setTimeout(HTTP_TIMEOUT_MS, () => {
    req.destroy(new Error(`Timeout (${HTTP_TIMEOUT_MS / 1000}s) em ${label}`));
  });
  return req;
}

async function withRetry(fn, label, maxAttempts = 3) {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (attempt === maxAttempts) throw err;
      const delay = attempt * 2000;
      console.log(`  ⚠ ${label} — tentativa ${attempt} falhou, aguardando ${delay / 1000}s... (${err.message})`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

function buildMultipart(fields, fileBuffer, filename) {
  const boundary = '----CloudinaryBoundary' + Date.now().toString(16) + Math.random().toString(36).slice(2);
  const crlf = '\r\n';
  const parts = [];

  for (const [name, value] of Object.entries(fields)) {
    parts.push(Buffer.from(
      `--${boundary}${crlf}` +
      `Content-Disposition: form-data; name="${name}"${crlf}${crlf}` +
      `${value}${crlf}`
    ));
  }

  parts.push(Buffer.from(
    `--${boundary}${crlf}` +
    `Content-Disposition: form-data; name="file"; filename="${filename}"${crlf}` +
    `Content-Type: image/png${crlf}${crlf}`
  ));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));

  return {
    body: Buffer.concat(parts),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

async function uploadImage(filePath) {
  return withRetry(async () => {
    const env = loadCredentials();
    const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = 'leandro-instagram';
    const publicId = `${folder}/${path.basename(filePath, '.png')}-${timestamp}`;

    const signParams = { folder, public_id: publicId, timestamp };
    const toSign = Object.keys(signParams).sort().map(k => `${k}=${signParams[k]}`).join('&') + apiSecret;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');

    const fileBuffer = fs.readFileSync(filePath);
    const { body, contentType } = buildMultipart(
      { api_key: apiKey, ...signParams, signature },
      fileBuffer,
      path.basename(filePath)
    );

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.cloudinary.com',
        path: `/v1_1/${cloudName}/image/upload`,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': body.length }
      };

      const req = withTimeout(https.request(options, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(data).secure_url); }
            catch { reject(new Error(`Cloudinary resposta inválida: ${data.slice(0, 200)}`)); }
          } else {
            reject(new Error(`Cloudinary erro ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }), 'Cloudinary uploadImage');
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }, `uploadImage(${path.basename(filePath)})`);
}

async function uploadVideo(filePath) {
  return withRetry(async () => {
    const env = loadCredentials();
    const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;

    const timestamp = Math.floor(Date.now() / 1000).toString();
    const folder = 'leandro-instagram';
    const publicId = `${folder}/${path.basename(filePath, '.mp4')}-${timestamp}`;

    const signParams = { folder, public_id: publicId, timestamp };
    const toSign = Object.keys(signParams).sort().map(k => `${k}=${signParams[k]}`).join('&') + apiSecret;
    const signature = crypto.createHash('sha1').update(toSign).digest('hex');

    const fileBuffer = fs.readFileSync(filePath);
    const { body, contentType } = buildMultipart(
      { api_key: apiKey, ...signParams, signature },
      fileBuffer,
      path.basename(filePath)
    );

    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.cloudinary.com',
        path: `/v1_1/${cloudName}/video/upload`,
        method: 'POST',
        headers: { 'Content-Type': contentType, 'Content-Length': body.length }
      };
      const req = withTimeout(https.request(options, res => {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => {
          const data = Buffer.concat(chunks).toString();
          if (res.statusCode === 200) {
            try { resolve(JSON.parse(data).secure_url); }
            catch { reject(new Error(`Cloudinary vídeo resposta inválida: ${data.slice(0, 200)}`)); }
          } else {
            reject(new Error(`Cloudinary vídeo erro ${res.statusCode}: ${data.slice(0, 300)}`));
          }
        });
      }), 'Cloudinary uploadVideo');
      req.on('error', reject);
      req.write(body);
      req.end();
    });
  }, `uploadVideo(${path.basename(filePath)})`);
}

module.exports = { uploadImage, uploadVideo };
