/**
 * instagram.cjs — Publicação via Instagram Graph API
 * Suporta renovação automática do access token (tokens expiram em 60 dias)
 */
const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../../.env');

function loadEnv() {
  const lines = fs.readFileSync(ENV_PATH, 'utf8').split('\n');
  const env = {};
  for (const line of lines) {
    const [k, ...v] = line.split('=');
    if (k && k.trim()) env[k.trim()] = v.join('=').trim();
  }
  return env;
}

function saveEnvKey(key, value) {
  let content = fs.readFileSync(ENV_PATH, 'utf8');
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        const parsed = JSON.parse(data);
        if (res.statusCode === 200) {
          resolve(parsed);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${JSON.stringify(parsed)}`));
        }
      });
    }).on('error', reject);
  });
}

function apiPost(endpoint, params, token) {
  const body = new URLSearchParams({ ...params, access_token: token }).toString();

  // Tokens novos (IGAAj...) usam graph.instagram.com; tokens antigos usam graph.facebook.com
  const hostname = token.startsWith('IGAA') ? 'graph.instagram.com' : 'graph.facebook.com';

  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path: `/v21.0/${endpoint}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = Buffer.concat(chunks).toString();
        const parsed = JSON.parse(data);
        if (res.statusCode === 200) {
          resolve(parsed);
        } else {
          reject(new Error(`Instagram API ${res.statusCode}: ${JSON.stringify(parsed)}`));
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// Renova o token automaticamente se restar menos de 7 dias para expirar
// Suporta tanto tokens do novo Instagram Business Login (IGAAj...) quanto tokens antigos (EAA...)
async function refreshTokenIfNeeded(env) {
  const token = env.INSTAGRAM_ACCESS_TOKEN;
  if (!token) throw new Error('INSTAGRAM_ACCESS_TOKEN não encontrada no .env');

  const expiresAt = parseInt(env.INSTAGRAM_TOKEN_EXPIRES_AT || '0');
  const sevenDaysMs = 7 * 24 * 60 * 60 * 1000;

  if (Date.now() < expiresAt - sevenDaysMs) {
    return token; // Token ainda válido
  }

  console.log('  ⚠ Token próximo do vencimento — renovando automaticamente...');

  let url;
  if (token.startsWith('IGAA')) {
    // Novo Instagram Business Login API
    url = `https://graph.instagram.com/refresh_access_token?grant_type=ig_refresh_token&access_token=${token}`;
  } else {
    // Token antigo via Facebook OAuth
    const appId = env.INSTAGRAM_APP_ID;
    const appSecret = env.INSTAGRAM_APP_SECRET;
    if (!appId || !appSecret) throw new Error('INSTAGRAM_APP_ID ou INSTAGRAM_APP_SECRET não encontrados no .env');
    url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${token}`;
  }

  const result = await httpsGet(url);
  const newToken = result.access_token;
  const newExpiry = Date.now() + (result.expires_in * 1000);

  saveEnvKey('INSTAGRAM_ACCESS_TOKEN', newToken);
  saveEnvKey('INSTAGRAM_TOKEN_EXPIRES_AT', newExpiry.toString());
  console.log('  ✅ Token renovado — próxima expiração em 60 dias');

  return newToken;
}

async function publishPost(imageUrl, caption, token, userId) {
  // Passo 1: Cria container de mídia
  const container = await apiPost(`${userId}/media`, {
    image_url: imageUrl,
    caption: caption
  }, token);

  const containerId = container.id;

  // Passo 2: Aguarda processamento
  await new Promise(r => setTimeout(r, 5000));

  // Passo 3: Publica
  const published = await apiPost(`${userId}/media_publish`, {
    creation_id: containerId
  }, token);

  return published.id;
}

async function publishReel(videoUrl, caption, token, userId, coverUrl) {
  // Passo 1: Cria container de Reel
  const params = {
    video_url: videoUrl,
    media_type: 'REELS',
    caption: caption,
    share_to_feed: 'true'
  };
  if (coverUrl) params.cover_url = coverUrl;
  const container = await apiPost(`${userId}/media`, params, token);

  const containerId = container.id;

  // Passo 2: Aguarda processamento do vídeo (pode demorar mais que imagem)
  console.log('  ⏳ Aguardando processamento do vídeo...');
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 10000));
    // Verifica status do container
    const hostname = token.startsWith('IGAA') ? 'graph.instagram.com' : 'graph.facebook.com';
    try {
      const status = await httpsGet(`https://${hostname}/v21.0/${containerId}?fields=status_code&access_token=${token}`);
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR') throw new Error('Processamento do vídeo falhou no Instagram');
    } catch (e) {
      if (e.message.includes('processamento')) throw e;
    }
  }

  // Passo 3: Publica
  const published = await apiPost(`${userId}/media_publish`, {
    creation_id: containerId
  }, token);

  return published.id;
}

async function publishStory(imageUrl, token, userId) {
  // Passo 1: Cria container de Story
  const container = await apiPost(`${userId}/media`, {
    image_url: imageUrl,
    media_type: 'STORIES'
  }, token);

  const containerId = container.id;

  // Passo 2: Aguarda processamento
  await new Promise(r => setTimeout(r, 5000));

  // Passo 3: Publica
  const published = await apiPost(`${userId}/media_publish`, {
    creation_id: containerId
  }, token);

  return published.id;
}

async function publishVideoStory(videoUrl, token, userId) {
  // Passo 1: Cria container de Story com vídeo
  const container = await apiPost(`${userId}/media`, {
    video_url: videoUrl,
    media_type: 'STORIES'
  }, token);

  const containerId = container.id;
  const hostname = token.startsWith('IGAA') ? 'graph.instagram.com' : 'graph.facebook.com';

  // Passo 2: Aguarda processamento do vídeo (pode levar até 2 minutos)
  console.log('  ⏳ Aguardando processamento do vídeo story...');
  for (let i = 0; i < 24; i++) {
    await new Promise(r => setTimeout(r, 10000));
    try {
      const status = await httpsGet(
        `https://${hostname}/v21.0/${containerId}?fields=status_code,status&access_token=${token}`
      );
      console.log(`     status: ${status.status_code || status.status} (tentativa ${i + 1}/24)`);
      if (status.status_code === 'FINISHED') break;
      if (status.status_code === 'ERROR') throw new Error(`Processamento do vídeo story falhou: ${JSON.stringify(status)}`);
    } catch (e) {
      if (e.message.includes('Processamento')) throw e;
    }
  }

  // Passo 3: Publica
  const published = await apiPost(`${userId}/media_publish`, {
    creation_id: containerId
  }, token);

  return published.id;
}

/**
 * Publica carrossel de imagens no feed do Instagram.
 * @param {string[]} imageUrls - URLs públicas das imagens (2 a 10)
 * @param {string}   caption   - Legenda do post
 * @param {string}   token     - Access token
 * @param {string}   userId    - Instagram User ID
 */
async function publishCarousel(imageUrls, caption, token, userId) {
  // Passo 1: Cria container individual para cada imagem
  const childIds = [];
  for (const url of imageUrls) {
    const child = await apiPost(`${userId}/media`, {
      image_url: url,
      is_carousel_item: 'true'
    }, token);
    childIds.push(child.id);
    await new Promise(r => setTimeout(r, 2000));
  }

  // Passo 2: Cria container do carrossel
  const carousel = await apiPost(`${userId}/media`, {
    media_type: 'CAROUSEL',
    caption:    caption,
    children:   childIds.join(',')
  }, token);

  // Passo 3: Aguarda processamento
  await new Promise(r => setTimeout(r, 8000));

  // Passo 4: Publica
  const published = await apiPost(`${userId}/media_publish`, {
    creation_id: carousel.id
  }, token);

  return published.id;
}

module.exports = { publishPost, publishReel, publishStory, publishVideoStory, publishCarousel, refreshTokenIfNeeded, loadEnv };
