#!/usr/bin/env node
/**
 * instagram-story.cjs — Alerta Patriota
 * Gera Story do dia (Bom Dia + prévia das notícias) e publica no Instagram
 * @roberto.braga.alerta.patriota
 * Roda via GitHub Actions às 8h BRT
 */
'use strict';

const path = require('path');
const fs   = require('fs');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { neon }            = require('@neondatabase/serverless');
const { htmlStoryBomDia, renderizarPng, carregarLogoBase64, OUTPUT_DIR } = require('./lib/gerador-slides.cjs');
const { pngToMp4 }        = require('./lib/ffmpeg.cjs');
const cloudinary          = require('cloudinary').v2;

// ── CONFIG ─────────────────────────────────────────────────────────────────
const DB_URL    = process.env.DATABASE_URL;
const IG_ID     = process.env.IG_USER_ID;
const IG_TOKEN  = process.env.IG_ACCESS_TOKEN;
const CLD_NAME  = process.env.CLOUDINARY_CLOUD_NAME;
const CLD_KEY   = process.env.CLOUDINARY_API_KEY;
const CLD_SEC   = process.env.CLOUDINARY_API_SECRET;
const APP_URL   = process.env.NEXT_PUBLIC_APP_URL || 'https://alertapatriota.vercel.app';

if (!DB_URL || !IG_ID || !IG_TOKEN) {
  console.log('⚠️  Credenciais Instagram não configuradas — Story não publicado');
  process.exit(0);
}

cloudinary.config({ cloud_name: CLD_NAME, api_key: CLD_KEY, api_secret: CLD_SEC });

// ── MAIN ───────────────────────────────────────────────────────────────────
async function main() {
  console.log('🇧🇷 Iniciando Story Bom Dia — Alerta Patriota');

  const sql = neon(DB_URL);

  // Busca top 3 notícias das últimas 8h
  const noticias = await sql`
    SELECT titulo, resumo_braga, id, urgente
    FROM noticias
    WHERE resumo_braga IS NOT NULL AND global = false
    AND created_at >= NOW() - INTERVAL '8 hours'
    ORDER BY urgente DESC, created_at DESC
    LIMIT 3
  `;

  if (!noticias.length) {
    console.log('📭 Sem notícias para o Story — pulando');
    process.exit(0);
  }

  // Gera PNG do Story
  const logoB64 = carregarLogoBase64();
  const html    = htmlStoryBomDia(noticias, logoB64);
  const pngPath = await renderizarPng(html, 'story-bomdia.png');
  console.log(`✅ PNG gerado: ${pngPath}`);

  // Converte PNG → MP4 (7 segundos)
  const mp4Path = path.join(OUTPUT_DIR, 'story-bomdia.mp4');
  pngToMp4(pngPath, mp4Path, 7);
  console.log(`✅ MP4 gerado: ${mp4Path}`);

  // Upload no Cloudinary
  const upload = await cloudinary.uploader.upload(mp4Path, {
    resource_type: 'video',
    folder:        'alerta-patriota/stories',
    public_id:     `story-bomdia-${Date.now()}`,
  });
  console.log(`☁️  Cloudinary: ${upload.secure_url}`);

  // Publica como Story no Instagram
  const container = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type:     'VIDEO',
      video_url:      upload.secure_url,
      media_category: 'STORIES',
      access_token:   IG_TOKEN,
    }),
  });
  const c = await container.json();
  if (c.error) throw new Error(`Erro ao criar container: ${c.error.message}`);

  // Aguarda processamento
  for (let i = 0; i < 12; i++) {
    await new Promise(r => setTimeout(r, 5000));
    const status = await fetch(`https://graph.facebook.com/v21.0/${c.id}?fields=status_code&access_token=${IG_TOKEN}`);
    const s = await status.json();
    if (s.status_code === 'FINISHED') break;
    if (s.status_code === 'ERROR')    throw new Error('Instagram rejeitou o vídeo do Story');
    console.log(`⏳ Processando... (${i+1}/12)`);
  }

  // Publica
  const pub = await fetch(`https://graph.facebook.com/v21.0/${IG_ID}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: c.id, access_token: IG_TOKEN }),
  });
  const p = await pub.json();
  if (p.error) throw new Error(`Erro ao publicar: ${p.error.message}`);

  console.log(`🎉 Story publicado! ID: ${p.id}`);

  // Registra no banco
  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes)
    VALUES ('instagram-story', 'publicar_story_bomdia', 'sucesso',
      ${JSON.stringify({ postId: p.id, noticias: noticias.length })})
  `;
}

main().catch(err => {
  console.error('❌ Erro:', err.message);
  process.exit(1);
});
