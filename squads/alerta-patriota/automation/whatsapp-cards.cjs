#!/usr/bin/env node
/**
 * whatsapp-cards.cjs â€” Alerta Patriota
 * Gera cards visuais (imagem + texto) para os 4 grupos WhatsApp
 * Roda via GitHub Actions â€” usa Puppeteer com Chromium disponÃ­vel no GA
 *
 * Fluxo: DB â†’ HTML â†’ PNG (Puppeteer) â†’ Cloudinary â†’ Evolution API
 */
'use strict';

const path      = require('path');
const fs        = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { neon }        = require('@neondatabase/serverless');
const puppeteer       = require('puppeteer');
const cloudinary      = require('cloudinary').v2;
const { sendTelegram, horaBRT, dataBRT } = require('./telegram-reporter.cjs');
const { gerarTexto }  = require('./ai-helper.cjs');

// â”€â”€ CONFIG â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const DB_URL   = process.env.DATABASE_URL;
const EVO_URL        = process.env.EVOLUTION_API_URL;
const EVO_KEY        = process.env.EVOLUTION_API_KEY;
const EVO_INST_VIP   = process.env.EVOLUTION_INSTANCIA       || 'alertapatriota';
const EVO_INST_ELITE = process.env.EVOLUTION_INSTANCIA_ELITE  || 'alertapatriota';

function getInstancia(plano) {
  return plano === 'elite' ? EVO_INST_ELITE : EVO_INST_VIP;
}

const GROUP_IDS = {
  basico:   process.env.WPP_GROUP_BASICO,
  patriota: process.env.WPP_GROUP_PATRIOTA,
  vip:      process.env.WPP_GROUP_VIP,
  elite:    process.env.WPP_GROUP_ELITE,
};

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const sql       = neon(DB_URL);
const OUTPUT    = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });

// â”€â”€ PERSONAS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const PERSONAS_DIR = path.join(__dirname, '../app/public/personas');

// 9 imagens por persona â€” rotaÃ§Ã£o 1 por dia (todas as publicaÃ§Ãµes do dia usam a mesma)
const FOTOS_BRAGA = [
  'braga-01.png', // sentado Ã  mesa escritÃ³rio
  'braga-02.png', // comentando notÃ­cia
  'braga-03.png', // ambiente profissional, olhando para cÃ¢mera
  'braga-04.png', // retrato patriÃ³tico
  'braga-05.png', // em pÃ©, apontando, indignado
  'braga-06.png', // cenÃ¡rio rural, questionamento
  'braga-07.png', // terno, estÃºdio de notÃ­cias
  'braga-08.png', // praÃ§a, braÃ§os abertos
  'braga-09.png', // frente a construÃ§Ã£o rÃºstica
];

const FOTOS_CAVALCANTI = [
  'cavalcanti-01.png', // imagem redes sociais
  'cavalcanti-02.png', // comentando com microfone
  'cavalcanti-03.png', // CapitÃ³lio
  'cavalcanti-04.png', // Londres, beira do rio
  'cavalcanti-05.png', // Parlamento Europeu
  'cavalcanti-06.png', // estÃºdio com mapa global
  'cavalcanti-07.png', // anÃ¡lise financeira, ambiente moderno
  'cavalcanti-08.png', // estÃºdio moderno
  'cavalcanti-09.png', // terminal de aeroporto
];

const PERSONAS = {
  basico:   { nome:'CapitÃ£o Roberto Braga',        titulo:'ALERTA BÃSICO',   cor:'#ffd700', label:'ALERTA BÃSICO',   fotos: FOTOS_BRAGA,       assinatura:'Comentarista Â· Alerta Patriota'   },
  patriota: { nome:'CapitÃ£o Roberto Braga',        titulo:'ALERTA PATRIOTA', cor:'#ffd700', label:'ALERTA PATRIOTA', fotos: FOTOS_BRAGA,       assinatura:'Comentarista Â· Alerta Patriota'   },
  vip:      { nome:'CapitÃ£o Roberto Braga',        titulo:'VIP PREMIUM',     cor:'#ff4444', label:'VIP PREMIUM',     fotos: FOTOS_BRAGA,       assinatura:'Comentarista Â· Alerta Patriota'   },
  elite:    { nome:'Prof. Dr. Bernardo Cavalcanti',titulo:'ELITE GLOBAL',    cor:'#a855f7', label:'ELITE GLOBAL',    fotos: FOTOS_CAVALCANTI,  assinatura:'Ex-USP Â· Consultor Internacional' },
};

const HOOK_PROMPTS = {
  basico:   'Crie UMA frase de impacto (mÃ¡ximo 12 palavras) sobre esta notÃ­cia no tom do CapitÃ£o Braga. Direto, patriÃ³tico. SEM aspas.',
  patriota: 'Crie UMA frase de impacto (mÃ¡ximo 12 palavras) sobre esta notÃ­cia. Indignado e direto. SEM aspas.',
  vip:      'Crie UMA frase bombÃ¡stica que cause IMPACTO e CURIOSIDADE (mÃ¡ximo 12 palavras). Tom: "o que a mÃ­dia esconde". SEM aspas.',
  elite:    'Crie UMA frase analÃ­tica e sofisticada do Prof. Cavalcanti (mÃ¡ximo 12 palavras). Tom intelectual e revelador. SEM aspas.',
};

const LEGENDA_PROMPTS = {
  basico: `VocÃª Ã© o CapitÃ£o Braga. Escreva um comentÃ¡rio curto (3-4 linhas) sobre esta notÃ­cia. Direto e patriÃ³tico. Sem cabeÃ§alho. Termine com: Deus, PÃ¡tria e FamÃ­lia â€” sempre. Responda APENAS com o texto.`,
  patriota: `VocÃª Ã© o CapitÃ£o Braga. Escreva 4-6 linhas: fato + comentÃ¡rio apaixonado. Sem cabeÃ§alho. Termine com: Deus, PÃ¡tria e FamÃ­lia â€” sempre. Responda APENAS com o texto.`,
  vip: `VocÃª Ã© o CapitÃ£o Braga. Use este formato EXATO:\n\nðŸ§  *O QUE ESTÃ ACONTECENDO*\n[2-3 linhas]\n\nðŸ” *O QUE A MÃDIA ESCONDE*\n[2-3 linhas]\n\nðŸŽ¯ *O QUE ISSO SIGNIFICA*\n[2-3 linhas]\n\nTermine com: Deus, PÃ¡tria e FamÃ­lia â€” sempre. Use apenas *negrito*. Responda APENAS com o texto.`,
  elite: `VocÃª Ã© o Prof. Bernardo Cavalcanti. Use este formato EXATO:\n\nðŸ§  *O QUE ESTÃ ACONTECENDO*\n[2-3 linhas]\n\nðŸŒ *MAPA GLOBAL*\n[2-3 linhas conectando a Milei, Trump, OrbÃ¡n]\n\nðŸŽ¯ *O QUE VOCÃŠ PRECISA SABER*\n[2-3 linhas sobre implicaÃ§Ã£o]\n\nTermine com: O mundo muda para quem enxerga antes. Use apenas *negrito*. Responda APENAS com o texto.`,
};

// â”€â”€ FILTRO: exclui notÃ­cias irrelevantes (esporte, celebridade, acidente) â”€â”€
const PALAVRAS_EXCLUIR = [
  // Acidente / trÃ¢nsito
  'motociclista','acidente','marginal','tietÃª','atropel','batida','colisÃ£o',
  'morte no trÃ¢nsito','engavetamento',
  // SaÃºde, medicina e nutriÃ§Ã£o
  'nutricionista','nutricionist','dieta','emagrecimento','reeducaÃ§Ã£o alimentar',
  'alimentaÃ§Ã£o saudÃ¡vel','alimento saudÃ¡vel','suplemento','vitamina',
  'cÃ¢ncer de','tumor','oncologia','pressÃ£o alta','diabetes','colesterol',
  'remÃ©dio caseiro','mÃ©dico diz','estudo mostra','pesquisa revela',
  'exercÃ­cio fÃ­sico','musculaÃ§Ã£o','academia','bem-estar','saÃºde e bem',
  // Mortes de artistas / mÃºsicos / entretenimento
  'falecimento','faleceu','morreu','obituÃ¡rio','morre o','morre a',
  'morte do cantor','morte da cantora','morte do mÃºsico','morte do artista',
  'lendÃ¡rio frontman','banda argentina','banda de rock','rock argentino',
  'mÃºsico argentino','cantor argentino','artista argentino',
  'roqueiro','frontman','los redonditos','indio solari',
  'hospital','internado','internada',
  'celebridade','famoso','ator','atriz','cantor','cantora','show','novela',
  'fontenelle','xuxa','faustÃ£o','gkay','virgÃ­nia','influencer',
  // Esporte
  'futebol','copa','campeonato','gol','jogador','atleta','esporte',
  'olimpÃ­ada','nba','nfl','tÃªnis','vÃ´lei',
  // Entretenimento digital
  'reality','bbb','masterchef','netflix','sÃ©rie','cinema','streaming',
  // Moda
  'moda','estilo','beleza','biquÃ­ni','maquiagem',
  // PrÃªmios de entretenimento
  'grande otelo','grammy','oscar','emmy','indicados ao prÃªmio',
];

function ehConteudoIrrelevante(titulo) {
  const t = (titulo || '').toLowerCase();
  return PALAVRAS_EXCLUIR.some(p => t.includes(p));
}

// â”€â”€ HELPERS â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const VERCEL_URL     = process.env.NEXT_PUBLIC_APP_URL || 'https://alertapatriota.vercel.app';
const PERSONAS_LOCAL = path.join(__dirname, '../app/public/personas');

// Converte imagem local para base64 data URL
// Embed direto no HTML â€” sem dependÃªncia de URL externa nem file://, funciona sempre
function imgBase64(nome) {
  const localPath = path.join(PERSONAS_LOCAL, nome);
  if (fs.existsSync(localPath)) {
    const data = fs.readFileSync(localPath);
    return `data:image/png;base64,${data.toString('base64')}`;
  }
  // Fallback para Vercel se arquivo local nÃ£o existir
  return `${VERCEL_URL}/personas/${nome}`;
}

function fotoUrl(nome) { return imgBase64(nome); }
function logoUrl()     { return imgBase64('logo.png'); }

// Escolhe foto sequencialmente pelo total de publicaÃ§Ãµes jÃ¡ enviadas para o grupo
// Garante que cada notÃ­cia publicada usa a PRÃ“XIMA imagem disponÃ­vel, sem repetiÃ§Ã£o
// SÃ³ repetem apÃ³s esgotar todas as 9 imagens (ciclo completo)
async function escolherFoto(fotos, plano) {
  try {
    const rows = await sql`
      SELECT COUNT(*) as total FROM agentes_log
      WHERE agente = 'gerador-card'
        AND acao = ${`card_${plano}`}
        AND status = 'sucesso'
    `;
    const totalPublicados = parseInt(rows[0].total) || 0;
    return fotos[totalPublicados % fotos.length];
  } catch {
    // Fallback: usa hora atual se banco falhar
    const h = new Date().getHours();
    return fotos[h % fotos.length];
  }
}

async function gerarHTML(plano, hook, fonte, urgente) {
  const p = PERSONAS[plano];
  const foto = fotoUrl(await escolherFoto(p.fotos, plano));
  const logo = logoUrl();
  const isElite = plano === 'elite';

  // Tamanho da fonte do hook baseado no comprimento â€” legÃ­vel no celular
  const hl = hook.length;
  const hookSize = hl <= 30 ? '96px' : hl <= 45 ? '82px' : hl <= 60 ? '70px' : '58px';

  // Hook em caixa alta para impacto visual
  const hookUpper = hook.toUpperCase();

  if (isElite) {
    // â”€â”€ PROF. CAVALCANTI: full-bleed com gradiente roxo â”€â”€
    return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1080px;overflow:hidden;background:#07071a;position:relative;}
.foto{position:absolute;inset:0;
      background:url('${foto}') center top/cover no-repeat;}
.grad{position:absolute;inset:0;
      background:linear-gradient(to bottom,
        rgba(7,7,26,.30) 0%,
        rgba(7,7,26,.0)  14%,
        rgba(7,7,26,.0)  52%,
        rgba(7,7,26,.80) 72%,
        rgba(7,7,26,.96) 100%);}
.badge{position:absolute;top:44px;left:44px;
       background:${urgente?'#7c3aed':'#5b21b6'};color:#e9d5ff;
       font-family:Arial Black,Impact,sans-serif;
       font-size:24px;font-weight:900;letter-spacing:4px;
       padding:12px 28px;text-transform:uppercase;}
${logo ? `.logo{position:absolute;top:36px;right:44px;
  width:68px;height:68px;border-radius:50%;
  border:3px solid #a855f7;object-fit:cover;}`:''}
.hook{position:absolute;bottom:148px;left:0;right:0;padding:0 50px;
      font-family:Arial Black,Impact,sans-serif;
      font-size:${hookSize};font-weight:900;color:#fff;
      line-height:1.05;text-transform:uppercase;
      text-shadow:0 4px 24px rgba(0,0,0,.95);}
.footer{position:absolute;bottom:0;left:0;right:0;
        background:rgba(88,28,135,.9);
        border-top:3px solid #a855f7;
        padding:24px 44px;
        display:flex;align-items:center;justify-content:space-between;}
.f-left{font-size:20px;font-weight:900;color:#e9d5ff;
        letter-spacing:2px;text-transform:uppercase;}
.f-right{text-align:right;}
.f-nome{font-size:18px;font-weight:800;color:#fff;}
.f-cargo{font-size:11px;color:rgba(233,213,255,.6);
         letter-spacing:1px;margin-top:3px;text-transform:uppercase;}
</style></head><body>
  <div class="foto"></div>
  <div class="grad"></div>
  <div class="badge">${urgente ? 'ðŸš¨ URGENTE' : 'ANÃLISE GLOBAL'}</div>
  ${logo ? `<img src="${logo}" class="logo"/>` : ''}
  <div class="hook">${hookUpper}</div>
  <div class="footer">
    <div class="f-left">O MUNDO MUDA PARA<br>QUEM ENXERGA ANTES.</div>
    <div class="f-right">
      <div class="f-nome">PROF. BERNARDO CAVALCANTI</div>
      <div class="f-cargo">ELITE GLOBAL</div>
    </div>
  </div>
</body></html>`;
  }

  // â”€â”€ CAPITÃƒO BRAGA: full-bleed foto com texto grande e impactante â”€â”€
  const BADGE_LABEL = {
    basico:   urgente ? 'ðŸš¨ URGENTE'    : 'POLÃTICA',
    patriota: urgente ? 'ðŸš¨ URGENTE'    : 'ANÃLISE PATRIOTA',
    vip:      urgente ? 'ðŸš¨ URGENTE'    : 'ðŸ”¥ VIP EXCLUSIVO',
  };
  const badge = BADGE_LABEL[plano] || 'POLÃTICA';

  return `<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
*{margin:0;padding:0;box-sizing:border-box;}
body{width:1080px;height:1080px;overflow:hidden;background:#000;position:relative;}
.foto{position:absolute;inset:0;
      background:url('${foto}') center top/cover no-repeat;}
.grad{position:absolute;inset:0;
      background:linear-gradient(to bottom,
        rgba(0,0,0,.28) 0%,
        rgba(0,0,0,.0)  14%,
        rgba(0,0,0,.0)  52%,
        rgba(0,0,0,.80) 72%,
        rgba(0,0,0,.96) 100%);}
.badge{position:absolute;top:44px;left:44px;
       background:#c0392b;color:#fff;
       font-family:Arial Black,Impact,sans-serif;
       font-size:24px;font-weight:900;letter-spacing:3px;
       padding:12px 28px;text-transform:uppercase;}
${logo ? `.logo{position:absolute;top:36px;right:44px;
  width:68px;height:68px;border-radius:50%;
  border:3px solid #ffd700;object-fit:cover;}`:''}
.hook{position:absolute;bottom:148px;left:0;right:0;padding:0 50px;
      font-family:Arial Black,Impact,sans-serif;
      font-size:${hookSize};font-weight:900;color:#fff;
      line-height:1.05;text-transform:uppercase;
      text-shadow:0 4px 24px rgba(0,0,0,.95);}
.footer{position:absolute;bottom:0;left:0;right:0;
        background:#c0392b;
        padding:24px 44px;
        display:flex;align-items:center;justify-content:space-between;}
.f-left{font-size:20px;font-weight:900;color:#fff;
        letter-spacing:2px;text-transform:uppercase;}
.f-right{text-align:right;}
.f-nome{font-size:18px;font-weight:800;color:#fff;}
.f-cargo{font-size:11px;color:rgba(255,255,255,.7);
         letter-spacing:1px;margin-top:3px;text-transform:uppercase;}
</style></head><body>
  <div class="foto"></div>
  <div class="grad"></div>
  <div class="badge">${badge}</div>
  ${logo ? `<img src="${logo}" class="logo"/>` : ''}
  <div class="hook">${hookUpper}</div>
  <div class="footer">
    <div class="f-left">DEUS, PÃTRIA E FAMÃLIA</div>
    <div class="f-right">
      <div class="f-nome">CAPITÃƒO ROBERTO BRAGA</div>
      <div class="f-cargo">ALERTA PATRIOTA</div>
    </div>
  </div>
</body></html>`;
}

async function gerarHookeClaude(titulo, plano) {
  const texto = await gerarTexto({
    model: 'claude-haiku-4-5-20251001', max_tokens: 60,
    messages: [{ role: 'user', content: `${HOOK_PROMPTS[plano]}\n\nNOTÃCIA: "${titulo}"` }],
  });
  return texto
    ? texto.replace(/["""]/g, '').replace(/^#+\s*/, '')
    : titulo;
}

async function gerarLegendaClaude(titulo, plano, fonte) {
  // Prompts atualizados: sem cabeÃ§alho artificial, texto direto como se a persona digitou
  const legendaPrompts = {
    basico: `VocÃª Ã© o CapitÃ£o Roberto Braga. Escreva 3-4 linhas diretamente sobre esta notÃ­cia, como se estivesse digitando para seus seguidores agora. Sem cabeÃ§alho, sem data, sem nome de seÃ§Ã£o. Comece direto com o conteÃºdo. Termine com: Deus, PÃ¡tria e FamÃ­lia â€” sempre. Responda APENAS com o texto.`,
    patriota: `VocÃª Ã© o CapitÃ£o Roberto Braga. Escreva 4-5 linhas sobre esta notÃ­cia: fato + comentÃ¡rio apaixonado. Sem cabeÃ§alho, sem data. Comece direto. Termine com: Deus, PÃ¡tria e FamÃ­lia â€” sempre. Responda APENAS com o texto.`,
    vip: `VocÃª Ã© o CapitÃ£o Roberto Braga. Escreva anÃ¡lise no formato:\n\nðŸ§  *O QUE ESTÃ ACONTECENDO*\n[2-3 linhas]\n\nðŸ” *O QUE A MÃDIA ESCONDE*\n[2-3 linhas]\n\nðŸŽ¯ *O QUE ISSO SIGNIFICA*\n[2-3 linhas]\n\nSem cabeÃ§alho de seÃ§Ã£o antes. Termine com: Deus, PÃ¡tria e FamÃ­lia â€” sempre. Use *negrito*. Responda APENAS com o texto.`,
    elite: `VocÃª Ã© o Prof. Bernardo Cavalcanti. Escreva anÃ¡lise no formato:\n\nðŸ§  *O QUE ESTÃ ACONTECENDO*\n[2-3 linhas]\n\nðŸŒ *MAPA GLOBAL*\n[2-3 linhas conectando a Milei, Trump, OrbÃ¡n ou cenÃ¡rio internacional]\n\nðŸŽ¯ *O QUE VOCÃŠ PRECISA SABER*\n[2-3 linhas sobre implicaÃ§Ã£o]\n\nSem cabeÃ§alho antes. Termine com: O mundo muda para quem enxerga antes. Use *negrito*. Responda APENAS com o texto.`,
  };

  const texto = await gerarTexto({
    model: 'claude-haiku-4-5-20251001', max_tokens: 500,
    messages: [{ role: 'user', content: `${legendaPrompts[plano]}\n\nNOTÃCIA: "${titulo}"\nFONTE: ${fonte}` }],
  });
  const corpo = texto
    ? texto.replace(/^#+\s*/gm, '').replace(/\*\*/g, '*')
    : '';

  // Assinatura natural no final â€” sem caixa, sem data/hora
  const assinaturas = {
    basico:   `\n\n_Fonte: ${fonte}_`,
    patriota: `\n\n_Fonte: ${fonte}_`,
    vip:      `\n\n_Fonte: ${fonte}_`,
    elite:    `\n\n_Prof. Bernardo Cavalcanti Â· Elite Global_\n_Fonte: ${fonte}_`,
  };

  return `${corpo}${assinaturas[plano]}`;
}

async function enviarImagemWPP(imageUrl, groupJid, legenda, plano) {
  const res = await fetch(`${EVO_URL}/message/sendMedia/${getInstancia(plano)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({
      number: groupJid,
      mediaMessage: {
        mediatype: 'image',
        media: imageUrl,
        caption: legenda,
        fileName: 'alerta-patriota.jpg',
      },
    }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.log(`  âš ï¸  Evolution API ${res.status}: ${err.substring(0, 150)}`);
  }
  return res.ok;
}

// â”€â”€ ENVIO DE TEXTO SIMPLES (para FOMO e avisos) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
async function enviarTextoWPP(groupJid, texto) {
  const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST_VIP}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({ number: groupJid, textMessage: { text: texto } }),
  });
  if (!res.ok) {
    const err = await res.text().catch(() => '');
    console.log(`  âš ï¸  sendText ${res.status}: ${err.substring(0, 100)}`);
  }
  return res.ok;
}

// â”€â”€ FÃBIO FOMO â€” teaser para grupos inferiores (mÃ¡x 2x/dia, espaÃ§ado 10h) â”€â”€
async function fomoEnviadoRecentemente() {
  try {
    const rows = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'fabio-fomo'
        AND status = 'sucesso'
        AND created_at > NOW() - INTERVAL '10 hours'
      LIMIT 1
    `;
    return rows.length > 0;
  } catch { return false; }
}

async function dispararFOMO(hook, planoExclusivo) {
  // Rate limit: sÃ³ envia se passaram pelo menos 10h desde o Ãºltimo FOMO
  // Resultado: ~2 envios/dia (manhÃ£ e noite), sem spam
  if (await fomoEnviadoRecentemente()) {
    console.log('  â­ï¸  FOMO: jÃ¡ enviado nas Ãºltimas 10h â€” pulando');
    return 0;
  }

  const label     = planoExclusivo === 'elite' ? 'Elite Global' : 'VIP Premium';
  const hookCurto = hook.length > 70 ? hook.substring(0, 67) + '...' : hook;

  const mensagem = `ðŸ”¥ *EXCLUSIVO ${label.toUpperCase()} â€” AGORA*\n\n"${hookCurto}"\n\nðŸ‘† Essa anÃ¡lise sÃ³ os membros ${label} receberam hoje.\n\nFaÃ§a upgrade e nunca mais perca as anÃ¡lises mais profundas do Alerta Patriota:\nðŸ‘‰ alertapatriota.vercel.app`;

  // Elite â†’ BÃ¡sico + Patriota + VIP | VIP â†’ BÃ¡sico + Patriota
  const destinos = planoExclusivo === 'elite'
    ? [GROUP_IDS.basico, GROUP_IDS.patriota, GROUP_IDS.vip]
    : [GROUP_IDS.basico, GROUP_IDS.patriota];

  let enviados = 0;
  for (const jid of destinos) {
    if (!jid) continue;
    if (await enviarTextoWPP(jid, mensagem)) enviados++;
    await new Promise(r => setTimeout(r, 2000));
  }

  if (enviados > 0) {
    // Registra o envio para o rate limit funcionar
    await sql`
      INSERT INTO agentes_log(agente, acao, status, detalhes)
      VALUES('fabio-fomo', 'fomo_enviado', 'sucesso',
        ${JSON.stringify({ plano: planoExclusivo, destinos: destinos.length, enviados })})
    `.catch(() => {});
  }

  console.log(`  ðŸ”¥ FOMO: ${enviados}/${destinos.length} grupos notificados`);
  return enviados;
}

// â”€â”€ MAIN â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Fontes generalistas que nÃ£o devem ser publicadas
const FONTES_EXCLUIR = ['metrÃ³poles', 'metropoles', 'uol', 'globo', 'folha', 'estadÃ£o'];

function ehFonteIrrelevante(fonte) {
  const f = (fonte || '').toLowerCase();
  return FONTES_EXCLUIR.some(s => f.includes(s));
}

// Limite diÃ¡rio de cards por grupo (evita publicar em excesso por testes/dispatches)
const LIMITE_DIARIO = { basico: 3, patriota: 3, vip: 6, elite: 6 };

async function jaAtingiuLimiteDiario(plano) {
  try {
    // Conta cards enviados HOJE no fuso BRT (zera Ã  meia-noite, nÃ£o janela rolling)
    const rows = await sql`
      SELECT COUNT(*) as total FROM agentes_log
      WHERE agente = 'gerador-card'
        AND acao = ${`card_${plano}`}
        AND status = 'sucesso'
        AND created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'America/Sao_Paulo') AT TIME ZONE 'America/Sao_Paulo'
    `;
    const total = parseInt(rows[0].total);
    const limite = LIMITE_DIARIO[plano] || 3;
    if (total >= limite) {
      console.log(`  â­ï¸  ${plano} jÃ¡ atingiu limite de ${limite} cards hoje (atual: ${total})`);
      return true;
    }
    return false;
  } catch { return false; }
}

async function processarPlano(plano, browser) {
  console.log(`\n  [${plano}] Buscando notÃ­cia...`);
  const groupJid = GROUP_IDS[plano];
  if (!groupJid) { console.log(`  âš ï¸  Grupo ${plano} nÃ£o configurado`); return; }

  // Verifica limite diÃ¡rio â€” impede excesso por mÃºltiplos workflow_dispatch
  if (await jaAtingiuLimiteDiario(plano)) return null;

  let rows;
  // Exclui MetrÃ³poles e outras fontes generalistas diretamente no SQL
  if (plano === 'basico')   rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_basico=false AND resumo_braga IS NOT NULL AND (global IS NULL OR global = false) AND fonte NOT ILIKE '%metrÃ³poles%' AND fonte NOT ILIKE '%metropoles%' ORDER BY urgente DESC,created_at DESC LIMIT 5`;
  if (plano === 'patriota') rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_patriota=false AND resumo_braga IS NOT NULL AND (global IS NULL OR global = false) AND fonte NOT ILIKE '%metrÃ³poles%' AND fonte NOT ILIKE '%metropoles%' ORDER BY urgente DESC,created_at DESC LIMIT 5`;
  if (plano === 'vip')      rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_vip_card=false AND resumo_braga IS NOT NULL AND (global IS NULL OR global = false) AND fonte NOT ILIKE '%metrÃ³poles%' AND fonte NOT ILIKE '%metropoles%' ORDER BY urgente DESC,created_at DESC LIMIT 5`;
  if (plano === 'elite')    rows = await sql`SELECT id,titulo,fonte,urgente FROM noticias WHERE postada_elite_card=false AND resumo_cavalcanti IS NOT NULL AND fonte NOT ILIKE '%metrÃ³poles%' AND fonte NOT ILIKE '%metropoles%' ORDER BY urgente DESC,global DESC,created_at DESC LIMIT 5`;

  // Filtra tÃ­tulo irrelevante E fonte generalista, pega a primeira vÃ¡lida
  const rowsFiltradas = (rows || []).filter(r =>
    !ehConteudoIrrelevante(r.titulo) && !ehFonteIrrelevante(r.fonte)
  );
  if (!rowsFiltradas.length) { console.log(`  âš ï¸  Sem notÃ­cia polÃ­tica disponÃ­vel para ${plano}`); return; }
  const n = rowsFiltradas[0];
  const fonte = n.fonte || 'Alerta Patriota';
  console.log(`  ðŸ“° NotÃ­cia: ${n.titulo.substring(0,60)}...`);

  // Gera hook e legenda em paralelo
  const [hook, legenda] = await Promise.all([
    gerarHookeClaude(n.titulo, plano),
    gerarLegendaClaude(n.titulo, plano, fonte),
  ]);
  console.log(`  ðŸ’¡ Hook: "${hook}"`);

  // Renderiza HTML â†’ PNG
  const html = await gerarHTML(plano, hook, fonte, n.urgente);

  // Imagens jÃ¡ estÃ£o em base64 no HTML â€” sem requests externos, sem file://
  // domcontentloaded Ã© suficiente; aguardamos 1.5s para CSS pintar o background
  const page = await browser.newPage();
  await page.setViewport({ width:1080, height:1080 });
  await page.setContent(html, { waitUntil:'domcontentloaded', timeout:20000 });
  await new Promise(r => setTimeout(r, 1500));
  const pngPath = path.join(OUTPUT, `card-${plano}.png`);
  await page.screenshot({ path: pngPath, type:'png', clip:{x:0,y:0,width:1080,height:1080} });
  await page.close();
  console.log(`  ðŸ–¼ï¸  PNG gerado: ${pngPath}`);

  // Upload Cloudinary
  const upload = await cloudinary.uploader.upload(pngPath, {
    resource_type: 'image', folder: 'alerta-patriota/cards', public_id: `card-${plano}-${Date.now()}`,
  });
  console.log(`  â˜ï¸  Cloudinary: ${upload.secure_url}`);

  // Envia via WhatsApp
  const ok = await enviarImagemWPP(upload.secure_url, groupJid, legenda, plano);
  if (ok) {
    // Marca como publicada
    if (plano==='basico')   await sql`UPDATE noticias SET postada_basico=true,postada_basico_at=NOW() WHERE id=${n.id}`;
    if (plano==='patriota') await sql`UPDATE noticias SET postada_patriota=true,postada_patriota_at=NOW() WHERE id=${n.id}`;
    if (plano==='vip')      await sql`UPDATE noticias SET postada_vip_card=true,postada_vip_card_at=NOW() WHERE id=${n.id}`;
    if (plano==='elite')    await sql`UPDATE noticias SET postada_elite_card=true,postada_elite_card_at=NOW() WHERE id=${n.id}`;
    await sql`INSERT INTO agentes_log(agente,acao,status,detalhes) VALUES('gerador-card',${`card_${plano}`},'sucesso',${JSON.stringify({hook,noticiaId:n.id})})`;
    console.log(`  âœ… Card enviado para o grupo ${plano}!`);
  } else {
    console.log(`  âŒ Falha ao enviar para Evolution API`);
    await sendTelegram(`âŒ *FALHA â€” Card WhatsApp*\nGrupo: ${plano}\nHook: "${hook.substring(0, 60)}"\nðŸ• ${horaBRT()} BRT`);
  }

  await new Promise(r => setTimeout(r, 3000));
  return ok ? hook : null;
}

async function main() {
  console.log('ðŸŽ¨ Gerando cards visuais â€” Alerta Patriota');
  const planos = process.argv.slice(2).length ? process.argv.slice(2) : ['basico','patriota','vip','elite'];

  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox','--disable-setuid-sandbox','--disable-gpu','--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXEC_PATH || undefined,
  });

  const resultados = [];
  let melhorHookVIP   = null;
  let melhorHookElite = null;

  try {
    for (const plano of planos) {
      if (!PERSONAS[plano]) { console.log(`Plano invÃ¡lido: ${plano}`); continue; }
      try {
        const hook = await processarPlano(plano, browser);
        // null = limite atingido ou sem notÃ­cia â€” NÃƒO Ã© sucesso
        if (hook !== null && hook !== undefined) {
          resultados.push({ plano, ok: true, enviado: true });
          if (plano === 'vip'   && !melhorHookVIP)   melhorHookVIP   = hook;
          if (plano === 'elite' && !melhorHookElite) melhorHookElite = hook;
        } else {
          resultados.push({ plano, ok: false, enviado: false, erro: 'sem notÃ­cia ou limite diÃ¡rio atingido' });
        }
      } catch (e) {
        console.error(`  âŒ Erro no plano ${plano}:`, e.message);
        resultados.push({ plano, ok: false, enviado: false, erro: e.message });
      }
    }
  } finally {
    await browser.close();
  }

  // FÃ¡bio FOMO â€” dispara APENAS 1Ã— por rodada, usando o melhor hook disponÃ­vel
  // Prioriza Elite (mais premium), depois VIP
  const hookFOMO  = melhorHookElite || melhorHookVIP;
  const planoFOMO = melhorHookElite ? 'elite' : melhorHookVIP ? 'vip' : null;
  if (hookFOMO && planoFOMO) {
    console.log('\nðŸ”¥ Disparando FOMO Ãºnico para BÃ¡sico + Patriota...');
    await dispararFOMO(hookFOMO, planoFOMO);
  }

  // Resumo honesto no Telegram â€” sÃ³ âœ… quando card foi realmente enviado
  const enviados = resultados.filter(r => r.enviado);
  const naoEnviados = resultados.filter(r => !r.enviado);
  const fomoTxt = planoFOMO ? `\nðŸ”¥ FOMO enviado (${planoFOMO})` : '';

  if (enviados.length > 0) {
    const okTxt = enviados.map(r => `âœ… ${r.plano}`).join('\n');
    const errTxt = naoEnviados.length > 0
      ? '\n' + naoEnviados.map(r => `â­ï¸ ${r.plano}: ${r.erro?.substring(0,50)}`).join('\n')
      : '';
    await sendTelegram(
      `ðŸŽ¨ *Cards Visuais â€” Alerta Patriota*\nðŸ“… ${dataBRT()} Â· ${horaBRT()} BRT\n\n${okTxt}${errTxt}${fomoTxt}`
    );
  } else {
    // Nenhum card enviado â€” alerta real para investigar
    await sendTelegram(
      `âš ï¸ *Cards Visuais â€” NENHUM CARD ENVIADO*\nðŸ“… ${dataBRT()} Â· ${horaBRT()} BRT\n\n` +
      naoEnviados.map(r => `â­ï¸ ${r.plano}: ${r.erro?.substring(0,60)}`).join('\n') +
      '\n\nVerifique: limite diÃ¡rio, notÃ­cias disponÃ­veis ou erro no script.'
    );
  }

  console.log('\nâœ… Cards concluÃ­dos!');
}

main().catch(err => { console.error('âŒ Erro:', err.message); process.exit(1); });

