/**
 * generate-pool-video.cjs — Gera um novo vídeo para o pool Kling com modelo diferente
 *
 * Uso: node generate-pool-video.cjs [id-do-video]
 *   id-do-video: ID customizado para salvar no pool (ex: 10-loira-verde-rotacao)
 *                Se não informado, escolhe automaticamente da fila de pendentes.
 *
 * Após gerar, adiciona o vídeo ao kling-pool/ e atualiza o VIDEO_POOL no publisher.
 */

'use strict';

const fs   = require('fs');
const path = require('path');
const { execSync } = require('child_process');

(function loadEnv() {
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) process.env[k.trim()] = v.join('=').trim();
  }
})();

const { generateVideoFromText } = require('./lib/kling.cjs');

const POOL_DIR      = path.join(__dirname, 'kling-pool');
const TEMP_DIR      = path.join(__dirname, 'temp');
const PUBLISHER_CJS = path.join(__dirname, 'kling-publisher.cjs');

// ── Pool de novas variações para gerar ───────────────────────────────────────
// Cada entrada tem aparência diferente da modelo, roupa e estilo de câmera
const PENDING_VIDEOS = [
  {
    id: '10-loira-verde-rotacao',
    tags: ['glúteo','pernas','bumbum','quadril','rotação'],
    label: 'Loira | Verde | Rotação 360',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
long straight blonde hair down, fair skin with light freckles, green eyes, warm confident smile,
wearing forest green high-waist full-length leggings and matching forest green athletic crop top fully covering chest, white sneakers,
standing in bright modern gym with large floor-to-ceiling windows, natural wood floor, gym equipment visible,
slowly rotating 360 degrees showing full body, camera stays fixed while she rotates gracefully,
golden soft light through windows, smooth cinematic 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '11-ruiva-lilas-caminhada-frontal',
    tags: ['cardio','emagrecimento','metabolismo','caminhada','energia'],
    label: 'Ruiva | Lilás | Caminhada frontal câmera',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
long wavy auburn red hair in loose half-up bun, warm olive skin, brown eyes, wide genuine smile,
wearing lilac purple high-waist full-length leggings and matching lilac purple high-neck racerback sports bra fully covering chest, white sneakers,
walking confidently forward toward camera in bright modern gym, wooden floor, large windows with natural daylight,
camera stays fixed as she walks toward it revealing face then full body, smooth cinematic tracking,
soft warm natural gym lighting, 4K vertical 9:16 reel format, no text, no watermark, no multiple people`
  },
  {
    id: '12-morena-escura-coral-ombro',
    tags: ['ombro','postura','parte superior','bíceps','força'],
    label: 'Morena escura | Coral | Shoulder press câmera lateral',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
short natural curly dark hair, rich dark brown skin, white teeth warm smile,
wearing coral orange high-waist full-length leggings and matching coral orange athletic crop top fully covering chest, white sneakers,
standing confidently in modern gym with large windows and natural light, gym equipment in background,
lateral side camera angle, arms slightly raised showing toned arms, natural breathing micro-movements, hair gently swaying,
smooth cinematic realistic motion, 4K vertical 9:16 reel format, no text, no watermark, no multiple people`
  },
  {
    id: '13-loira-curta-azul-angulo-baixo',
    tags: ['força','músculo','superação','intensidade','treino pesado'],
    label: 'Loira curta | Azul | Ângulo baixo para cima',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
short platinum blonde straight hair, light fair skin, blue eyes, powerful confident expression,
wearing royal blue high-waist full-length leggings and matching royal blue athletic crop top fully covering chest, white sneakers,
standing confidently in bright modern gym, hands firmly on hips,
dramatic low camera angle looking up at her, showing full body from feet to face, gym ceiling and windows visible,
powerful dramatic lighting from above, smooth confident cinematic motion, 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '14-morena-ondulada-preta-pernas-close',
    tags: ['pernas','panturrilha','abdômen','ciclo','feminino'],
    label: 'Morena ondulada | Preto | Close pernas para cima',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
long wavy dark brunette hair loose down, medium tan skin, dark eyes, warm genuine smile,
wearing black high-waist full-length leggings and black athletic crop top fully covering chest, black sneakers with white sole,
walking forward in bright modern gym with wooden floor and floor-to-ceiling windows,
camera starts at close-up of legs and feet then slowly pulls up revealing full body and face smiling at camera,
smooth cinematic upward reveal, soft warm gym lighting, 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '15-negra-vermelho-cintura-quadril',
    tags: ['motivação','mindset','nutrição','proteína','dica','alimentação'],
    label: 'Negra | Vermelho | Cintura e quadril',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
natural kinky afro hair with gold accessories, rich dark chocolate skin, bright white smile, charismatic energy,
wearing deep red high-waist full-length leggings and matching deep red athletic crop top fully covering chest, white sneakers,
standing in bright modern gym with large windows and soft natural daylight, gym equipment in background,
natural confident hip sway and waist movement while smiling warmly at camera,
camera slowly pulls back to reveal full body, smooth cinematic feminine motion, 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  // ── Segunda rodada de vídeos diversos (geração automática) ────────────────────
  {
    id: '16-negra-verde-rotacao',
    tags: ['glúteo','pernas','bumbum','quadril','metabolismo'],
    label: 'Negra cabelo box braids | Verde | Rotação 360',
    prompt: `beautiful slim athletic Black Brazilian woman personal trainer in her late 20s,
long box braids dark hair with subtle highlights, rich medium brown skin, bright warm smile, confident energy,
wearing emerald green high-waist full-length leggings and matching emerald green athletic crop top fully covering chest, white sneakers,
standing in bright modern gym with large floor-to-ceiling windows and natural wood floor, gym equipment visible,
slowly rotating 360 degrees showing full body, camera stays fixed while she rotates gracefully,
golden soft warm light through windows, smooth cinematic 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '17-loira-laranja-caminhada',
    tags: ['cardio','emagrecimento','queima','gordura','energia','disposição'],
    label: 'Loira ondulada | Laranja | Caminhada frontal',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
long wavy golden blonde hair loose down, light fair skin with warm tan, green eyes, wide radiant smile,
wearing burnt orange high-waist full-length leggings and matching burnt orange high-neck sports bra fully covering chest, white sneakers,
walking confidently forward toward camera in bright modern gym, wooden floor, large windows with natural daylight,
camera stays fixed as she walks toward it revealing full body, smooth cinematic tracking,
soft warm natural gym lighting, 4K vertical 9:16 reel format, no text, no watermark, no multiple people`
  },
  {
    id: '18-ruiva-preto-angulo-baixo',
    tags: ['força','músculo','superação','intensidade','braço','biceps'],
    label: 'Ruiva cabelo curto | Preto | Ângulo baixo para cima',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
short natural curly auburn red hair, warm fair freckled skin, blue-green eyes, powerful confident expression,
wearing sleek black high-waist full-length leggings and matching black athletic crop top fully covering chest, black sneakers with white sole,
standing confidently in bright modern gym with hands on hips,
dramatic low camera angle looking up at her, showing full body from feet to face, gym ceiling and windows visible,
strong dramatic natural lighting from above, smooth confident cinematic motion, 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '19-morena-lilas-cintura-quadril',
    tags: ['abdômen','cintura','core','hormônio','ciclo','feminino','silhueta'],
    label: 'Morena clara lisa | Lilás | Cintura e quadril',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
long straight dark brown hair loose down, warm medium tan skin, dark brown eyes, genuine warm smile,
wearing lavender purple high-waist full-length leggings and matching lavender purple athletic crop top fully covering chest, white sneakers,
standing in bright modern gym with large windows and soft natural daylight, gym equipment in background,
natural confident hip sway and waist movement while smiling warmly at camera,
camera slowly pulls back to reveal full body, smooth cinematic feminine motion, 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '20-negra-azul-ombro',
    tags: ['ombro','postura','superior','força','parte superior'],
    label: 'Negra cabelo curto | Azul royal | Shoulder press lateral',
    prompt: `beautiful slim athletic Black Brazilian woman personal trainer in her late 20s,
short natural coily afro hair, rich dark brown skin, bright white smile, elegant strong energy,
wearing royal blue high-waist full-length leggings and matching royal blue athletic crop top fully covering chest, white sneakers,
standing confidently in modern gym with large windows and natural light, gym equipment in background,
lateral side camera angle, arms slightly raised showing toned arms, natural breathing micro-movements,
smooth cinematic realistic motion, 4K vertical 9:16 reel format, no text, no watermark, no multiple people`
  },
  {
    id: '21-loira-platinada-branco-close',
    tags: ['motivação','mindset','dica','nutrição','proteína','alimentação'],
    label: 'Loira platinada | Branco | Close rosto sorrindo',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
straight platinum blonde bob haircut, very fair porcelain skin, blue eyes, warm bright genuine smile, approachable energy,
wearing all-white high-waist full-length leggings and matching white athletic crop top fully covering chest, white sneakers,
standing in bright modern gym bathed in natural light from large windows, clean minimal gym background,
close-up starting from chest and slowly pulling back to full body while she smiles and makes small natural gestures,
soft bright airy gym lighting, smooth cinematic 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '22-ruiva-amarelo-pernas-close',
    tags: ['pernas','panturrilha','glúteo','coxa','ciclo','feminino'],
    label: 'Ruiva cabelo longo | Amarelo | Close pernas revelando',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
long straight bright auburn red hair in high ponytail, light olive skin, brown eyes, warm confident smile,
wearing golden yellow high-waist full-length leggings and matching yellow athletic crop top fully covering chest, white sneakers,
walking forward in bright modern gym with wooden floor and floor-to-ceiling windows,
camera starts at close-up of legs and feet then slowly pulls up revealing full body and face smiling at camera,
smooth cinematic upward reveal, soft warm gym lighting, 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '23-morena-escura-branco-rotacao',
    tags: ['glúteo','bumbum','quadril','emagrecimento','resultado'],
    label: 'Morena escura cacheada | Branco | Rotação 360',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
long wavy dark brunette hair loose down with subtle highlights, medium brown skin, dark eyes, radiant smile,
wearing all-white high-waist full-length leggings and matching white athletic crop top fully covering chest, white sneakers,
standing in bright modern gym with large floor-to-ceiling windows, natural wood floor, gym equipment visible,
slowly rotating 360 degrees showing full body, camera stays fixed while she rotates gracefully,
bright natural gym lighting, smooth cinematic 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
  {
    id: '24-negra-afro-amarelo-caminhada',
    tags: ['cardio','metabolismo','queima','disposição','emagrecimento'],
    label: 'Negra afro volumoso | Amarelo | Caminhada frontal',
    prompt: `beautiful slim athletic Black Brazilian woman personal trainer in her late 20s,
big natural afro hair with golden sheen, rich dark chocolate skin, brilliant white smile, vibrant energetic personality,
wearing mustard yellow high-waist full-length leggings and matching yellow high-neck racerback sports bra fully covering chest, white sneakers,
walking confidently forward toward camera in bright modern gym, wooden floor, large windows with natural daylight,
camera stays fixed as she walks toward it revealing full body and face, smooth cinematic tracking,
warm natural gym lighting, 4K vertical 9:16 reel format, no text, no watermark, no multiple people`
  },
  {
    id: '25-loira-curta-verde-angulo-baixo',
    tags: ['força','superação','intensidade','treino pesado','músculo'],
    label: 'Loira cabelo curto pixie | Verde escuro | Ângulo baixo',
    prompt: `beautiful slim athletic Brazilian woman personal trainer in her late 20s,
short pixie cut dirty blonde hair, light fair skin, hazel eyes, determined powerful expression, athletic build,
wearing dark forest green high-waist full-length leggings and matching dark green athletic crop top fully covering chest, white sneakers,
standing confidently in bright modern gym with hands on hips,
dramatic low camera angle looking up at her, showing full body from feet to face, gym ceiling visible,
powerful dramatic lighting, smooth confident cinematic motion, 4K vertical 9:16 reel format,
no text, no watermark, no multiple people`
  },
];

const NEGATIVE = 'blurry, distorted, low quality, artifacts, text, watermark, logo, nudity, bikini, lingerie, revealing clothes, deformed face, crooked eyes, bad teeth, extra limbs, multiple people, ugly, overweight, fat, muscular bodybuilder';

async function main() {
  const requestedId = process.argv[2];

  // Descobre quais IDs já existem no pool
  const existingIds = new Set(
    fs.readdirSync(POOL_DIR)
      .filter(f => f.endsWith('.mp4'))
      .map(f => f.replace('.mp4', ''))
  );

  // Seleciona qual vídeo gerar
  let target;
  if (requestedId) {
    target = PENDING_VIDEOS.find(v => v.id === requestedId);
    if (!target) {
      console.error(`ID "${requestedId}" não encontrado na lista de pendentes.`);
      console.log('IDs disponíveis:');
      PENDING_VIDEOS.forEach(v => console.log(`  - ${v.id}: ${v.label}`));
      process.exit(1);
    }
  } else {
    // Pega o primeiro pendente que ainda não existe no pool
    target = PENDING_VIDEOS.find(v => !existingIds.has(v.id));
    if (!target) {
      console.log('✅ Todos os vídeos do PENDING_VIDEOS já existem no pool!');
      console.log('Adicione novos prompts em PENDING_VIDEOS para continuar.');
      process.exit(0);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`🎬 GERANDO NOVO VÍDEO KLING PARA O POOL`);
  console.log('═'.repeat(60));
  console.log(`ID:      ${target.id}`);
  console.log(`Modelo:  ${target.label}`);
  console.log(`Tags:    ${target.tags.join(', ')}`);
  console.log(`Destino: ${path.join(POOL_DIR, target.id + '.mp4')}`);
  console.log('\n⏳ Enviando para Kling AI (~5-8 minutos)...\n');

  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  const tempPath = path.join(TEMP_DIR, `pool-gen-${target.id}-${Date.now()}.mp4`);

  const fullPrompt = `${target.prompt.replace(/\n/g, ' ').trim()}, ${NEGATIVE.split(', ').map(n => `no ${n}`).join(', ')}`;

  try {
    await generateVideoFromText(target.prompt.replace(/\n/g, ' ').trim(), tempPath);
  } catch (err) {
    console.error(`\n❌ Falha na geração: ${err.message}`);
    process.exit(1);
  }

  // Move para o pool
  const poolPath = path.join(POOL_DIR, `${target.id}.mp4`);
  fs.copyFileSync(tempPath, poolPath);
  fs.unlinkSync(tempPath);

  const sizeMb = (fs.statSync(poolPath).size / 1024 / 1024).toFixed(1);
  console.log(`\n✅ Vídeo adicionado ao pool: ${poolPath} (${sizeMb} MB)`);

  // Atualiza VIDEO_POOL no kling-publisher.cjs
  const publisherSrc = fs.readFileSync(PUBLISHER_CJS, 'utf8');
  const newEntry = `  { id: '${target.id}', file: '${target.id}.mp4', tags: [${target.tags.map(t => `'${t}'`).join(', ')}] },`;

  if (publisherSrc.includes(`'${target.id}'`)) {
    console.log(`ℹ️  ID "${target.id}" já existe no VIDEO_POOL do publisher — não duplicando.`);
  } else {
    const updated = publisherSrc.replace(
      /(const VIDEO_POOL = \[[\s\S]*?)(];)/,
      (match, body, closing) => `${body}${newEntry}\n${closing}`
    );
    fs.writeFileSync(PUBLISHER_CJS, updated, 'utf8');
    console.log(`✅ VIDEO_POOL atualizado em kling-publisher.cjs`);
  }

  console.log('\n' + '═'.repeat(60));
  console.log(`🎉 CONCLUÍDO!`);
  console.log(`   Vídeo: ${target.label}`);
  console.log(`   Pool:  ${poolPath}`);
  console.log(`   Tags:  ${target.tags.join(', ')}`);
  console.log('═'.repeat(60));
  console.log('\nPróximo passo: rode kling-publisher.cjs para publicar hoje.');
}

main().catch(err => {
  console.error('\n💥 ERRO FATAL:', err.message);
  process.exit(1);
});
