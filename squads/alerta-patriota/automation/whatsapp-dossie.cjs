#!/usr/bin/env node
'use strict';

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { neon }    = require('@neondatabase/serverless');
const puppeteer   = require('puppeteer');
const cloudinary  = require('cloudinary').v2;
const { sendTelegram, horaBRT, dataBRT } = require('./telegram-reporter.cjs');
const { gerarTexto } = require('./ai-helper.cjs');

const DB_URL   = process.env.DATABASE_URL;
const EVO_URL  = process.env.EVOLUTION_API_URL;
const EVO_KEY  = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || 'alertapatriota';
const JID_ELITE = process.env.WPP_GROUP_ELITE;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const sql       = neon(DB_URL);

const OUTPUT = path.join(__dirname, 'output');
if (!fs.existsSync(OUTPUT)) fs.mkdirSync(OUTPUT, { recursive: true });

function numeroSemana() {
  const now   = new Date();
  const start = new Date(now.getFullYear(), 0, 1);
  return Math.ceil(((now - start) / 86400000 + start.getDay() + 1) / 7);
}

async function buscarNoticiasElite() {
  return sql`
    SELECT n.titulo, n.fonte, n.resumo_cavalcanti, n.urgente, n.global, n.created_at
    FROM noticias n
    WHERE n.resumo_cavalcanti IS NOT NULL
      AND n.created_at > NOW() - INTERVAL '7 days'
    ORDER BY n.urgente DESC, n.global DESC, n.created_at DESC
    LIMIT 5
  `;
}

async function gerarSintese(noticias) {
  const contexto = noticias
    .map((n, i) => `${i + 1}. ${n.titulo} (${n.fonte})`)
    .join('\n');

  const texto = await gerarTexto({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 500,
    messages: [{
      role: 'user',
      content: `Você é o Prof. Dr. Bernardo Cavalcanti, analista político global.
Com base nas análises desta semana, escreva uma síntese executiva de 280-320 palavras.
Tom: frio, analítico, intelectual. Sem emoções excessivas.
Conecte os eventos da semana a tendências globais (Milei, Trump, Orbán, agenda conservadora).
Termine com: "O mundo muda para quem enxerga antes."

ANÁLISES DA SEMANA:
${contexto}

Responda APENAS com o texto da síntese.`,
    }],
  });

  return texto || '';
}

function gerarHTML(noticias, sintese, semana) {
  const dataFormatada = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Sao_Paulo',
  });

  const blocos = noticias.map((n, i) => {
    const icone  = n.urgente ? '🚨' : n.global ? '🌍' : '🇧🇷';
    const titulo = n.titulo.replace(/^\[(EN|ES|PT)\]\s*/i, '');
    const resumo = (n.resumo_cavalcanti || '').split('\n').slice(0, 3).join(' ').substring(0, 300);
    return `
      <div class="bloco">
        <div class="bloco-num">${String(i + 1).padStart(2, '0')}</div>
        <div class="bloco-body">
          <div class="bloco-icone-titulo">
            <span class="bloco-icone">${icone}</span>
            <h3 class="bloco-titulo">${titulo}</h3>
          </div>
          <div class="bloco-fonte">${n.fonte || 'Alerta Patriota'}</div>
          <p class="bloco-resumo">${resumo}${resumo.length >= 300 ? '...' : ''}</p>
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
<meta charset="UTF-8">
<style>
  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
  *{margin:0;padding:0;box-sizing:border-box;}
  body{
    width:794px;
    font-family:'Inter',Arial,sans-serif;
    background:#07071a;
    color:#e2e8f0;
    padding:0;
    min-height:1123px;
  }
  .header{
    background:linear-gradient(135deg,#0f0f2e 0%,#1a0a2e 50%,#0f0f2e 100%);
    border-bottom:3px solid #a855f7;
    padding:48px 52px 36px;
    position:relative;
    overflow:hidden;
  }
  .header::before{
    content:'';
    position:absolute;
    top:-60px;right:-60px;
    width:240px;height:240px;
    background:radial-gradient(circle,rgba(168,85,247,.18) 0%,transparent 70%);
    border-radius:50%;
  }
  .header-label{
    font-size:11px;font-weight:700;letter-spacing:5px;
    color:#a855f7;text-transform:uppercase;margin-bottom:12px;
  }
  .header-titulo{
    font-size:32px;font-weight:800;color:#fff;
    letter-spacing:1px;line-height:1.1;margin-bottom:8px;
  }
  .header-semana{
    font-size:13px;color:#94a3b8;letter-spacing:2px;
    text-transform:uppercase;margin-bottom:6px;
  }
  .header-data{
    font-size:13px;color:#64748b;
  }
  .watermark{
    position:absolute;bottom:16px;right:52px;
    font-size:48px;font-weight:900;
    color:rgba(168,85,247,.06);letter-spacing:6px;
    text-transform:uppercase;user-select:none;
  }
  .sintese-section{
    padding:40px 52px 32px;
    border-bottom:1px solid rgba(168,85,247,.2);
  }
  .section-label{
    font-size:10px;font-weight:700;letter-spacing:4px;
    color:#7c3aed;text-transform:uppercase;margin-bottom:16px;
  }
  .sintese-text{
    font-size:13.5px;line-height:1.85;color:#cbd5e1;
    font-style:italic;
  }
  .noticias-section{
    padding:32px 52px 40px;
  }
  .bloco{
    display:flex;gap:20px;align-items:flex-start;
    padding:20px 0;
    border-bottom:1px solid rgba(255,255,255,.06);
  }
  .bloco:last-child{border-bottom:none;}
  .bloco-num{
    font-size:28px;font-weight:800;
    color:rgba(168,85,247,.35);
    min-width:36px;line-height:1;padding-top:2px;
    font-feature-settings:'tnum';
  }
  .bloco-body{flex:1;}
  .bloco-icone-titulo{
    display:flex;gap:10px;align-items:flex-start;margin-bottom:4px;
  }
  .bloco-icone{font-size:16px;line-height:1.4;}
  .bloco-titulo{
    font-size:14px;font-weight:700;color:#f1f5f9;line-height:1.4;
  }
  .bloco-fonte{
    font-size:10.5px;font-weight:500;letter-spacing:1.5px;
    color:#7c3aed;text-transform:uppercase;margin-bottom:6px;
  }
  .bloco-resumo{
    font-size:12.5px;line-height:1.75;color:#94a3b8;
  }
  .footer{
    background:linear-gradient(135deg,#0f0f2e 0%,#160824 100%);
    border-top:3px solid #a855f7;
    padding:28px 52px;
    display:flex;align-items:center;justify-content:space-between;
  }
  .footer-nome{
    font-size:13px;font-weight:700;color:#e9d5ff;
    letter-spacing:1px;
  }
  .footer-frase{
    font-size:11px;color:#7c3aed;margin-top:4px;
    font-style:italic;letter-spacing:.5px;
  }
  .footer-badge{
    background:#4c1d95;border:1px solid #7c3aed;
    padding:8px 20px;border-radius:2px;
    font-size:10px;font-weight:800;letter-spacing:3px;
    color:#e9d5ff;text-transform:uppercase;
  }
</style>
</head>
<body>
  <div class="header">
    <div class="header-label">Elite Global · Inteligência Conservadora</div>
    <div class="header-titulo">DOSSIÊ SEMANAL</div>
    <div class="header-semana">Semana ${semana} · Análise Estratégica</div>
    <div class="header-data">${dataFormatada}</div>
    <div class="watermark">ELITE</div>
  </div>

  <div class="sintese-section">
    <div class="section-label">Síntese da Semana — Prof. Dr. Bernardo Cavalcanti</div>
    <p class="sintese-text">${sintese.replace(/\n/g, '<br>')}</p>
  </div>

  <div class="noticias-section">
    <div class="section-label">Top 5 Análises da Semana</div>
    ${blocos}
  </div>

  <div class="footer">
    <div>
      <div class="footer-nome">Prof. Dr. Bernardo Cavalcanti</div>
      <div class="footer-frase">O mundo muda para quem enxerga antes.</div>
    </div>
    <div class="footer-badge">Elite Global</div>
  </div>
</body>
</html>`;
}

async function gerarPDF(html, semana) {
  const browser = await puppeteer.launch({
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-gpu', '--disable-dev-shm-usage'],
    executablePath: process.env.PUPPETEER_EXEC_PATH || undefined,
  });

  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 });
    await new Promise(r => setTimeout(r, 1500));

    const pdfPath = path.join(OUTPUT, `dossie-elite-semana-${semana}.pdf`);
    await page.pdf({ path: pdfPath, format: 'A4', printBackground: true });
    await page.close();
    return pdfPath;
  } finally {
    await browser.close();
  }
}

async function uploadCloudinary(pdfPath, semana) {
  const result = await cloudinary.uploader.upload(pdfPath, {
    resource_type: 'raw',
    folder: 'alerta-patriota/dossies',
    public_id: `Dossie-Elite-Semana-${semana}-${Date.now()}`,
    use_filename: false,
  });
  return result.secure_url;
}

async function enviarDocumentoWPP(url, semana) {
  const caption = `📄 *DOSSIÊ SEMANAL — Semana ${semana}*\n_Prof. Dr. Bernardo Cavalcanti_\n\nSíntese exclusiva das 5 análises mais importantes desta semana.\n\nLeia com atenção. O mundo muda para quem enxerga antes.`;
  const res = await fetch(`${EVO_URL}/message/sendMedia/${EVO_INST}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', apikey: EVO_KEY },
    body: JSON.stringify({
      number: JID_ELITE,
      mediaMessage: {
        mediatype: 'document',
        media: url,
        fileName: `Dossie-Elite-SEMANA-${semana}.pdf`,
        caption,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => '');
    throw new Error(`Evolution API ${res.status}: ${err.substring(0, 150)}`);
  }
  return true;
}

async function main() {
  const diaSemana = new Date().toLocaleDateString('en-US', {
    weekday: 'long', timeZone: 'America/Sao_Paulo',
  });

  if (diaSemana !== 'Saturday' && !process.argv.includes('--forcar')) {
    console.log(`Dossiê só roda aos sábados. Hoje: ${diaSemana}`);
    return;
  }

  const semana = numeroSemana();
  console.log(`Davi Dossiê — Gerando Dossiê Semanal Elite (semana ${semana})...`);

  const inicio = Date.now();

  const jaEnviou = await sql`
    SELECT id FROM agentes_log
    WHERE agente = 'davi-dossie'
      AND created_at >= NOW() - INTERVAL '6 days'
    LIMIT 1
  `;

  if (jaEnviou.length > 0 && !process.argv.includes('--forcar')) {
    console.log('Dossiê já enviado esta semana.');
    return;
  }

  const noticias = await buscarNoticiasElite();
  if (!noticias.length) {
    await sendTelegram(`⚠️ *Davi Dossiê* — sem análises Elite esta semana\n📅 ${dataBRT()} · ${horaBRT()} BRT`);
    console.log('Sem notícias com resumo_cavalcanti nos últimos 7 dias.');
    return;
  }

  console.log(`  ${noticias.length} análises encontradas. Gerando síntese com Claude...`);
  const sintese = await gerarSintese(noticias);
  if (!sintese) throw new Error('Claude não gerou a síntese');

  console.log('  Gerando HTML e PDF com Puppeteer...');
  const html = gerarHTML(noticias, sintese, semana);
  const pdfPath = await gerarPDF(html, semana);
  console.log(`  PDF gerado: ${pdfPath}`);

  console.log('  Enviando para Cloudinary...');
  const cloudUrl = await uploadCloudinary(pdfPath, semana);
  console.log(`  Cloudinary: ${cloudUrl}`);

  console.log('  Enviando para grupo Elite via Evolution API...');
  await enviarDocumentoWPP(cloudUrl, semana);

  const duracao = Date.now() - inicio;
  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
    VALUES (
      'davi-dossie',
      'enviar_dossie',
      'sucesso',
      ${JSON.stringify({ semana, totalNoticias: noticias.length, cloudUrl })},
      ${duracao}
    )
  `;

  await sendTelegram(`📄 *Dossiê Semanal Elite enviado!*\nSemana ${semana} · ${noticias.length} análises\n📅 ${dataBRT()} · ${horaBRT()} BRT`);
  console.log(`Dossiê enviado com sucesso! (${duracao}ms)`);
}

main().catch(async err => {
  console.error('Erro:', err.message);
  await sendTelegram(`❌ *Davi Dossiê* — ERRO CRÍTICO\n${err.message.substring(0, 200)}\n📅 ${dataBRT()} · ${horaBRT()} BRT`);
  process.exit(1);
});
