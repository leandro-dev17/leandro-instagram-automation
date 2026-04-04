/**
 * setup-youtube-auth.cjs
 * Roda UMA VEZ para autenticar o canal YouTube e salvar o refresh token no .env
 *
 * Uso: node setup-youtube-auth.cjs
 */

const https   = require('https');
const http    = require('http');
const fs      = require('fs');
const path    = require('path');
const { exec } = require('child_process');

const ENV_PATH = path.join(__dirname, '../.env');

const CLIENT_ID     = '969894258718-bp17s0ad7tropj1ckm5flkc4q2qq0sj5.apps.googleusercontent.com';
const CLIENT_SECRET = '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';
const REDIRECT_URI  = 'http://localhost:8080/callback';
const SCOPES        = 'https://www.googleapis.com/auth/youtube.upload';

function saveEnvKey(key, value) {
  let content = fs.existsSync(ENV_PATH) ? fs.readFileSync(ENV_PATH, 'utf8') : '';
  const regex = new RegExp(`^${key}=.*$`, 'm');
  if (regex.test(content)) {
    content = content.replace(regex, `${key}=${value}`);
  } else {
    content = content.trimEnd() + `\n${key}=${value}\n`;
  }
  fs.writeFileSync(ENV_PATH, content, 'utf8');
}

function exchangeCode(code) {
  return new Promise((resolve, reject) => {
    const body = new URLSearchParams({
      code,
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      redirect_uri:  REDIRECT_URI,
      grant_type:    'authorization_code'
    }).toString();

    const options = {
      hostname: 'oauth2.googleapis.com',
      path:     '/token',
      method:   'POST',
      headers: {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body)
      }
    };

    const req = https.request(options, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.refresh_token) resolve(data);
        else reject(new Error(JSON.stringify(data)));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  console.log('════════════════════════════════════════════');
  console.log('  BioNexus Digital — YouTube Auth Setup');
  console.log('════════════════════════════════════════════');
  console.log('');

  const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_type=code` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&access_type=offline` +
    `&prompt=consent`;

  console.log('Abrindo navegador para autenticação...');
  console.log('');
  console.log('Se não abrir automaticamente, acesse esta URL:');
  console.log(authUrl);
  console.log('');

  // Tenta abrir o navegador automaticamente
  const start = process.platform === 'win32' ? 'start' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  exec(`${start} "${authUrl}"`);

  // Sobe servidor local para capturar o callback
  console.log('Aguardando autorização no navegador...');
  const code = await new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url, 'http://localhost:8080');
      const code = url.searchParams.get('code');
      if (code) {
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(`<h2 style="font-family:sans-serif;color:green;text-align:center;margin-top:80px">
          ✅ Autorizado com sucesso!<br><br>
          <span style="font-size:16px;color:#333">Pode fechar esta aba e voltar ao terminal.</span>
        </h2>`);
        server.close();
        resolve(code);
      } else {
        res.writeHead(400);
        res.end('Erro: código não encontrado');
        reject(new Error('Código OAuth não recebido'));
      }
    });
    server.listen(8080, () => {
      console.log('Servidor local rodando em http://localhost:8080');
    });
    server.on('error', reject);

    // Timeout de 3 minutos
    setTimeout(() => {
      server.close();
      reject(new Error('Timeout: autorização não realizada em 3 minutos'));
    }, 180000);
  });

  console.log('');
  console.log('✅ Código recebido! Trocando por refresh token...');

  const tokens = await exchangeCode(code);

  console.log('✅ Refresh token obtido com sucesso!');
  console.log('');

  // Salva no .env
  saveEnvKey('YOUTUBE_CLIENT_ID', CLIENT_ID);
  saveEnvKey('YOUTUBE_CLIENT_SECRET', CLIENT_SECRET);
  saveEnvKey('YOUTUBE_REFRESH_TOKEN', tokens.refresh_token);

  console.log('════════════════════════════════════════════');
  console.log('  Salvo no .env:');
  console.log(`  YOUTUBE_CLIENT_ID     = ${CLIENT_ID}`);
  console.log(`  YOUTUBE_CLIENT_SECRET = ${CLIENT_SECRET}`);
  console.log(`  YOUTUBE_REFRESH_TOKEN = ${tokens.refresh_token}`);
  console.log('════════════════════════════════════════════');
  console.log('');
  console.log('Próximo passo: adicione YOUTUBE_REFRESH_TOKEN nos GitHub Secrets.');
}

main().catch(err => {
  console.error('ERRO:', err.message);
  process.exit(1);
});
