#!/usr/bin/env node
/**
 * instagram-responder.cjs — Alerta Patriota
 * Responde comentários no Instagram no tom do Capitão Braga
 * Roda a cada 30min via GitHub Actions
 */
'use strict';

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '../app/.env.local') });

const { neon }      = require('@neondatabase/serverless');
const Anthropic     = require('@anthropic-ai/sdk');

const DB_URL   = process.env.DATABASE_URL;
const IG_ID    = process.env.IG_USER_ID;
const IG_TOKEN = process.env.IG_ACCESS_TOKEN;
const APP_URL  = process.env.NEXT_PUBLIC_APP_URL || 'https://alertapatriota.vercel.app';

if (!IG_ID || !IG_TOKEN) { console.log('⚠️  Sem credenciais IG'); process.exit(0); }

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const sql       = neon(DB_URL);

// Palavras que ativam resposta rápida com link (sem gastar Claude)
const GATILHOS_LINK = ['grupo', 'entrar', 'assinar', 'como faço', 'como me', 'quero', 'link', 'acesso', 'quanto custa', 'preço', 'valor'];

async function gerarResposta(autor, comentario) {
  const texto = comentario.toLowerCase();

  // Resposta rápida para gatilhos de conversão
  if (GATILHOS_LINK.some(g => texto.includes(g))) {
    return `Olá @${autor}! 🇧🇷\n\nPara entrar no grupo do Capitão Braga acesse:\n${APP_URL}/assinar\n\nPlanos a partir de R$12,90/mês. 7 dias por R$1!\n\nDeus, Pátria e Família — sempre. 🇧🇷`;
  }

  // Resposta com Claude para outros comentários
  const msg = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 120,
    messages: [{ role: 'user', content: `Você é o Capitão Braga no Instagram. Responda este comentário em 2 linhas máximo, de forma patriótica e direta.

Comentário de @${autor}: "${comentario}"

Se for elogio: agradeça brevemente.
Se for dúvida sobre o grupo: diga "Link na bio 👆"
Se for crítica: responda com firmeza mas educação.
Termine com "— Capitão Braga 🇧🇷"
Responda APENAS com o texto.` }],
  });

  return msg.content[0].type === 'text' ? msg.content[0].text.trim() : '';
}

async function main() {
  console.log('💬 Verificando comentários no Instagram...');

  // Busca posts recentes
  const midiasRes = await fetch(
    `https://graph.facebook.com/v21.0/${IG_ID}/media?fields=id,timestamp&limit=8&access_token=${IG_TOKEN}`
  );
  const midias = await midiasRes.json();
  if (!midias.data?.length) { console.log('Sem posts recentes'); return; }

  let respondidos = 0;

  for (const m of midias.data) {
    const comRes = await fetch(
      `https://graph.facebook.com/v21.0/${m.id}/comments?fields=id,text,username&access_token=${IG_TOKEN}`
    );
    const coms = await comRes.json();
    if (!coms.data?.length) continue;

    for (const c of coms.data) {
      if (!c.text?.trim()) continue;

      // Verifica se já respondemos
      const jaRespondeu = await sql`
        SELECT id FROM agentes_log
        WHERE agente = 'instagram-responder' AND detalhes->>'comentarioId' = ${c.id}
        LIMIT 1
      `;
      if (jaRespondeu.length) continue;

      const resposta = await gerarResposta(c.username || 'amigo', c.text);
      if (!resposta) continue;

      // Responde
      const repRes = await fetch(`https://graph.facebook.com/v21.0/${m.id}/replies`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: resposta, access_token: IG_TOKEN }),
      });
      const rep = await repRes.json();
      if (rep.error) { console.error(`Erro ao responder: ${rep.error.message}`); continue; }

      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('instagram-responder', 'responder_comentario', 'sucesso',
          ${JSON.stringify({ comentarioId: c.id, autor: c.username })})
      `;
      respondidos++;

      await new Promise(r => setTimeout(r, 2000)); // pausa entre respostas
    }
  }

  console.log(`✅ Respondidos: ${respondidos} comentários`);
}

main().catch(err => { console.error('❌', err.message); process.exit(1); });
