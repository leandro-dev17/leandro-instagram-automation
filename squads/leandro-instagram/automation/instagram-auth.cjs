/**
 * instagram-auth.cjs
 * Gera e salva o Instagram Access Token automaticamente.
 * Execute UMA VEZ para configurar. Depois o sistema roda sozinho.
 *
 * Uso: node instagram-auth.cjs
 */

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const ENV_PATH = path.join(__dirname, '../.env');

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
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    }).on('error', reject);
  });
}

async function exchangeCodeForToken(code, appId, appSecret) {
  const url = `https://graph.facebook.com/v21.0/oauth/access_token?client_id=${appId}&redirect_uri=http://localhost:3000/callback&client_secret=${appSecret}&code=${code}`;
  const result = await httpsGet(url);
  if (result.status !== 200) throw new Error('Erro ao trocar código: ' + JSON.stringify(result.body));
  return result.body.access_token;
}

async function exchangeForLongLivedToken(shortToken, appId, appSecret) {
  const url = `https://graph.facebook.com/v21.0/oauth/access_token?grant_type=fb_exchange_token&client_id=${appId}&client_secret=${appSecret}&fb_exchange_token=${shortToken}`;
  const result = await httpsGet(url);
  if (result.status !== 200) throw new Error('Erro ao obter token longo: ' + JSON.stringify(result.body));
  return result.body;
}

async function getInstagramUserId(token) {
  // Pega as páginas do Facebook vinculadas
  const pagesResult = await httpsGet(`https://graph.facebook.com/v21.0/me/accounts?access_token=${token}`);
  if (pagesResult.status !== 200) throw new Error('Erro ao buscar páginas: ' + JSON.stringify(pagesResult.body));

  const pages = pagesResult.body.data;
  if (!pages || pages.length === 0) throw new Error('Nenhuma Página do Facebook encontrada. Verifique se sua conta do Instagram está vinculada a uma Página.');

  // Para cada página, busca a conta do Instagram vinculada
  for (const page of pages) {
    const igResult = await httpsGet(`https://graph.facebook.com/v21.0/${page.id}?fields=instagram_business_account&access_token=${page.access_token || token}`);
    if (igResult.body.instagram_business_account) {
      return igResult.body.instagram_business_account.id;
    }
  }

  throw new Error('Nenhuma conta do Instagram Business encontrada nas suas Páginas do Facebook.');
}

async function main() {
  const env = loadEnv();
  const appId = env.INSTAGRAM_APP_ID;
  const appSecret = env.INSTAGRAM_APP_SECRET;

  if (!appId || !appSecret) {
    console.error('ERRO: INSTAGRAM_APP_ID e INSTAGRAM_APP_SECRET precisam estar no .env');
    process.exit(1);
  }

  const authUrl = `https://www.facebook.com/dialog/oauth?client_id=${appId}&redirect_uri=http://localhost:3000/callback&scope=instagram_basic,instagram_content_publish,pages_read_engagement,pages_show_list&response_type=code`;

  console.log('═══════════════════════════════════════════');
  console.log('Instagram Auth — Configuração inicial');
  console.log('═══════════════════════════════════════════');
  console.log('');
  console.log('Abrindo navegador para autorização...');
  console.log('');
  console.log('Se não abrir automaticamente, copie e cole este link no navegador:');
  console.log(authUrl);
  console.log('');

  // Abre o navegador automaticamente (Windows)
  const { exec } = require('child_process');
  exec(`start "" "${authUrl}"`);

  // Inicia servidor local para capturar o callback
  const server = http.createServer(async (req, res) => {
    if (!req.url.startsWith('/callback')) return;

    const urlParams = new URL(req.url, 'http://localhost:3000');
    const code = urlParams.searchParams.get('code');
    const error = urlParams.searchParams.get('error');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<h2>❌ Erro: ${error}</h2><p>Feche esta janela e tente novamente.</p>`);
      server.close();
      return;
    }

    if (!code) {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end('<h2>❌ Código não encontrado</h2>');
      server.close();
      return;
    }

    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`
      <html><body style="font-family:sans-serif;padding:40px;background:#1a1a2e;color:white">
        <h2>✅ Autorização recebida!</h2>
        <p>Salvando credenciais... pode fechar esta janela em alguns segundos.</p>
      </body></html>
    `);

    try {
      console.log('Código de autorização recebido. Trocando por token...');

      const shortToken = await exchangeCodeForToken(code, appId, appSecret);
      console.log('Token de curta duração obtido. Convertendo para longa duração (60 dias)...');

      const longTokenData = await exchangeForLongLivedToken(shortToken, appId, appSecret);
      const longToken = longTokenData.access_token;
      const expiresAt = Date.now() + (longTokenData.expires_in * 1000);

      console.log('Buscando Instagram User ID...');
      const igUserId = await getInstagramUserId(longToken);

      // Salva no .env
      saveEnvKey('INSTAGRAM_ACCESS_TOKEN', longToken);
      saveEnvKey('INSTAGRAM_TOKEN_EXPIRES_AT', expiresAt.toString());
      saveEnvKey('INSTAGRAM_USER_ID', igUserId);

      console.log('');
      console.log('═══════════════════════════════════════════');
      console.log('✅ CONFIGURAÇÃO CONCLUÍDA!');
      console.log(`   Instagram User ID: ${igUserId}`);
      console.log(`   Token válido por: 60 dias (renova automaticamente)`);
      console.log('═══════════════════════════════════════════');
      console.log('');
      console.log('Agora execute criar-tarefas-publicacao.bat para ativar a publicação automática!');

    } catch (err) {
      console.error('ERRO:', err.message);
    }

    server.close();
  });

  server.listen(3000, () => {
    console.log('Aguardando autorização no navegador...');
  });
}

main().catch(err => {
  console.error('ERRO FATAL:', err.message);
  process.exit(1);
});
