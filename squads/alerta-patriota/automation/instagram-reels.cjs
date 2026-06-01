#!/usr/bin/env node
/**
 * instagram-reels.cjs — Alerta Patriota
 * Gera Reel com slides das notícias do dia e publica no Instagram
 * @roberto.braga.alerta.patriota
 * Roda via GitHub Actions às 12h BRT
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { neon }            = require('@neondatabase/serverless');
const { htmlSlideNoticia, renderizarPng, carregarLogoBase64, OUTPUT_DIR } = require('./lib/gerador-slides.cjs');
const { slidesToMp4 }     = require('./lib/ffmpeg.cjs');
const cloudinary          = require('cloudinary').v2;

const DB_URL   = process.env.DATABASE_URL;
const IG_ID    = process.env.IG_USER_ID;
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const APP_URL  = process.env.NEXT_PUBLIC_APP_URL || 'https://alertapatriota.vercel.app';

if (!DB_URL || !IG_ID || !IG_TOKEN) {
  console.log('⚠️  Credenciais Instagram não configuradas — Reel não publicado');
  process.exit(0);
}

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key:    process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

async function main() {
  console.log('🎬 Iniciando Reel de Notícias — Alerta Patriota');

  const sql = neon(DB_URL);

  // Busca top 3–5 notícias do dia
  const noticias = await sql`
    SELECT id, titulo, resumo_braga, urgente
    FROM noticias
    WHERE resumo_braga IS NOT NULL AND global = false
    AND created_at >= NOW() - INTERVAL '14 hours'
    ORDER BY urgente DESC, created_at DESC
    LIMIT 4
  `;

  if (!noticias.length) {
    console.log('📭 Sem notícias para o Reel — pulando');
    process.exit(0);
  }

  // Verifica se já postou hoje
  const jaPostou = await sql`
    SELECT id FROM agentes_log
    WHERE agente = 'instagram-reels' AND acao = 'publicar_reel'
    AND created_at >= NOW() - INTERVAL '20 hours'
    LIMIT 1
  `;
  if (jaPostou.length) {
    console.log('✅ Reel já publicado hoje — pulando');
    process.exit(0);
  }

  const logoB64  = carregarLogoBase64();
  const total    = noticias.length;
  const pngPaths = [];

  // Gera PNG de cada slide
  for (let i = 0; i < total; i++) {
    const n    = noticias[i];
    const html = htmlSlideNoticia(n, i + 1, total, logoB64);
    const png  = await renderizarPng(html, `reel-slide-${i + 1}.png`);
    pngPaths.push(png);
    console.log(`✅ Slide ${i + 1}/${total} gerado`);
  }

  // Converte slides → MP4 (5s por slide)
  const mp4Path = path.join(OUTPUT_DIR, 'reel-noticias.mp4');
  slidesToMp4(pngPaths, mp4Path, 5);
  console.log(`✅ Reel MP4 gerado: ${mp4Path}`);

  // Upload Cloudinary
  const upload = await cloudinary.uploader.upload(mp4Path, {
    resource_type: 'video',
    folder:        'alerta-patriota/reels',
    public_id:     `reel-${Date.now()}`,
  });
  console.log(`☁️  Cloudinary: ${upload.secure_url}`);

  // Legenda com hashtags e link da notícia principal
  const noticiaId = noticias[0].id;
  const legenda = `🇧🇷 AS NOTÍCIAS DO DIA — SEM FILTRO

${noticias.map((n, i) => `${i+1}. ${n.titulo}`).join('\n')}

Análise completa do Capitão Braga 👇
${APP_URL}/noticias/${noticiaId}

#AlertaPatriota #Brasil #Conservador #SemFiltro #DeusPátriaFamília #NotíciasDodia #BrasilConservador #Capitalismo #Liberdade`;

  // Publica como Reel
  const container = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type:    'REELS',
      video_url:     upload.secure_url,
      caption:       legenda,
      share_to_feed: true,
      access_token:  IG_TOKEN,
    }),
  });
  const c = await container.json();
  if (c.error) throw new Error(`Erro container: ${c.error.message}`);

  // Aguarda processamento
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 6000));
    const status = await fetch(`https://graph.facebook.com/v21.0/${c.id}?fields=status_code&access_token=${IG_TOKEN}`);
    const s = await status.json();
    console.log(`⏳ Status: ${s.status_code} (${i+1}/15)`);
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR')    throw new Error('Instagram rejeitou o Reel');
  }

  const pub = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: IG_TOKEN }),
  });
  const p = await pub.json();
  if (p.error) throw new Error(`Erro ao publicar: ${p.error.message}`);

  console.log(`🎉 Reel publicado! ID: ${p.id}`);

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes)
    VALUES ('instagram-reels', 'publicar_reel', 'sucesso',
      ${JSON.stringify({ postId: p.id, slides: total, noticiaId })})
  `;
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
