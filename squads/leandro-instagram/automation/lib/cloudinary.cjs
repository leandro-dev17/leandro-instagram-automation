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

function buildMultipart(fields, fileBuffer, filename) {
  const boundary = '----CloudinaryBoundary' + Date.now().toString(16);
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
  const env = loadCredentials();
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = 'leandro-instagram';
  const publicId = `${folder}/${path.basename(filePath, '.png')}-${timestamp}`;

  // Assinatura: parâmetros em ordem alfabética + api_secret
  const params = { folder, public_id: publicId, timestamp };
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + apiSecret;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const fileBuffer = fs.readFileSync(filePath);
  const { body, contentType } = buildMultipart(
    { api_key: apiKey, folder, public_id: publicId, signature, timestamp },
    fileBuffer,
    path.basename(filePath)
  );

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/image/upload`,
      method: 'POST',
      headers: {
        'Content-Type': contentType,
        'Content-Length': body.length
      }
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode === 200) {
          const result = JSON.parse(data);
          resolve(result.secure_url);
        } else {
          reject(new Error(`Cloudinary erro ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function uploadVideo(filePath) {
  const env = loadCredentials();
  const { CLOUDINARY_CLOUD_NAME: cloudName, CLOUDINARY_API_KEY: apiKey, CLOUDINARY_API_SECRET: apiSecret } = env;

  const timestamp = Math.floor(Date.now() / 1000).toString();
  const folder = 'leandro-instagram';
  const publicId = `${folder}/${path.basename(filePath, '.mp4')}-${timestamp}`;
  const resourceType = 'video';

  const params = { folder, public_id: publicId, timestamp };
  const toSign = Object.keys(params).sort().map(k => `${k}=${params[k]}`).join('&') + apiSecret;
  const signature = crypto.createHash('sha1').update(toSign).digest('hex');

  const fileBuffer = fs.readFileSync(filePath);
  const boundary = '----CloudinaryBoundary' + Date.now().toString(16);
  const crlf = '\r\n';
  const parts = [];

  for (const [name, value] of Object.entries({ api_key: apiKey, folder, public_id: publicId, signature, timestamp })) {
    parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="${name}"${crlf}${crlf}${value}${crlf}`));
  }
  parts.push(Buffer.from(`--${boundary}${crlf}Content-Disposition: form-data; name="file"; filename="${path.basename(filePath)}"${crlf}Content-Type: video/mp4${crlf}${crlf}`));
  parts.push(fileBuffer);
  parts.push(Buffer.from(`${crlf}--${boundary}--${crlf}`));
  const body = Buffer.concat(parts);

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.cloudinary.com',
      path: `/v1_1/${cloudName}/${resourceType}/upload`,
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}`, 'Content-Length': body.length }
    };
    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        if (res.statusCode === 200) {
          resolve(JSON.parse(data).secure_url);
        } else {
          reject(new Error(`Cloudinary vídeo erro ${res.statusCode}: ${data.slice(0, 300)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

module.exports = { uploadImage, uploadVideo };
