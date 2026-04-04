/**
 * youtube.cjs — Publicação de Shorts no YouTube via Data API v3
 * Baixa o vídeo do Cloudinary e faz upload para o canal @leandroluiz2155
 */

const https = require('https');
const http  = require('http');
const fs    = require('fs');
const path  = require('path');
const os    = require('os');

const ENV_PATH = path.join(__dirname, '../../.env');

function loadEnv() {
  if (!fs.existsSync(ENV_PATH)) return {};
  const env = {};
  for (const line of fs.readFileSync(ENV_PATH, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim()) env[k.trim()] = v.join('=').trim();
  }
  return env;
}

function saveEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) content = content.replace(regex, `${key}=${value}`);
  else content = content.trimEnd() + `\n${key}=${value}\n`;
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

// Obtém novo access token usando o refresh token
function getAccessToken(clientId, clientSecret, refreshToken) {
  const body = new URLSearchParams({
    client_id:     clientId,
    client_secret: clientSecret,
    refresh_token: refreshToken,
    grant_type:    'refresh_token'
  }).toString();

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.access_token) resolve(data.access_token);
        else reject(new Error(`Falha ao renovar token YouTube: ${JSON.stringify(data)}`));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Baixa vídeo de uma URL para arquivo temporário
function downloadVideo(videoUrl) {
  const tmpPath = path.join(os.tmpdir(), `yt-upload-${Date.now()}.mp4`);

  return new Promise((resolve, reject) => {
    const protocol = videoUrl.startsWith('https') ? https : http;
    const file = fs.createWriteStream(tmpPath);

    protocol.get(videoUrl, res => {
      if (res.statusCode === 301 || res.statusCode === 302) {
        file.close();
        downloadVideo(res.headers.location).then(resolve).catch(reject);
        return;
      }
      res.pipe(file);
      file.on('finish', () => {
        file.close();
        resolve(tmpPath);
      });
    }).on('error', err => {
      fs.unlink(tmpPath, () => {});
      reject(err);
    });
  });
}

// Inicia upload resumível e retorna a upload URL
function initResumableUpload(metadata, accessToken, fileSize) {
  const body = JSON.stringify(metadata);

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'www.googleapis.com',
      path:     '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      method:   'POST',
      headers: {
        'Authorization':           `Bearer ${accessToken}`,
        'Content-Type':            'application/json',
        'X-Upload-Content-Type':   'video/mp4',
        'X-Upload-Content-Length': fileSize
      }
    }, res => {
      if (res.statusCode === 200) {
        resolve(res.headers.location);
      } else {
        const chunks = [];
        res.on('data', c => chunks.push(c));
        res.on('end', () => reject(new Error(`Init upload falhou ${res.statusCode}: ${Buffer.concat(chunks).toString()}`)));
      }
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Faz o upload do arquivo para a upload URL
function uploadVideoFile(uploadUrl, filePath, fileSize) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(uploadUrl);
    const isHttps = urlObj.protocol === 'https:';
    const protocol = isHttps ? https : http;

    const options = {
      hostname: urlObj.hostname,
      path:     urlObj.pathname + urlObj.search,
      method:   'PUT',
      headers: {
        'Content-Type':   'video/mp4',
        'Content-Length': fileSize
      }
    };

    const req = protocol.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201) {
          const data = JSON.parse(Buffer.concat(chunks).toString());
          resolve(data.id);
        } else {
          reject(new Error(`Upload falhou ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
        }
      });
    });
    req.on('error', reject);

    const stream = fs.createReadStream(filePath);
    stream.pipe(req);
    stream.on('error', reject);
  });
}

/**
 * Publica um Short no YouTube.
 * @param {string} videoUrl   - URL pública do vídeo (Cloudinary)
 * @param {string} title      - Título do Short (max 100 chars)
 * @param {string} description - Descrição com hashtags
 * @returns {string} YouTube video ID
 */
async function publishShort(videoUrl, title, description) {
  const env = loadEnv();
  const clientId     = env.YOUTUBE_CLIENT_ID;
  const clientSecret = env.YOUTUBE_CLIENT_SECRET;
  const refreshToken = env.YOUTUBE_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) {
    throw new Error('Credenciais YouTube não configuradas no .env (YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, YOUTUBE_REFRESH_TOKEN)');
  }

  console.log('  → YouTube: obtendo access token...');
  const accessToken = await getAccessToken(clientId, clientSecret, refreshToken);

  console.log('  → YouTube: baixando vídeo...');
  const tmpPath = await downloadVideo(videoUrl);
  const fileSize = fs.statSync(tmpPath).size;
  console.log(`  → YouTube: vídeo baixado (${(fileSize / 1024 / 1024).toFixed(1)} MB)`);

  const metadata = {
    snippet: {
      title:       title.slice(0, 100),
      description: description,
      tags:        ['fitness', 'treino', 'personal', 'shorts', 'leandropersonall'],
      categoryId:  '17' // Sports
    },
    status: {
      privacyStatus:           'public',
      selfDeclaredMadeForKids: false
    }
  };

  console.log('  → YouTube: iniciando upload...');
  const uploadUrl = await initResumableUpload(metadata, accessToken, fileSize);

  console.log('  → YouTube: enviando vídeo...');
  const videoId = await uploadVideoFile(uploadUrl, tmpPath, fileSize);

  // Limpa arquivo temporário
  try { fs.unlinkSync(tmpPath); } catch {}

  console.log(`  ✅ YouTube Short publicado! ID: ${videoId}`);
  return videoId;
}

module.exports = { publishShort };
