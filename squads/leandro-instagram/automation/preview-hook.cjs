'use strict';

(function loadEnv() {
  const fs = require('fs'), path = require('path');
  const envPath = path.join(__dirname, '../.env');
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && k.trim() && !k.trim().startsWith('#')) process.env[k.trim()] = v.join('=').trim();
  }
})();

const fs   = require('fs');
const path = require('path');
const SCHEDULE_DIR = path.join(__dirname, 'schedule');

function findDayPlan(dateStr) {
  const files = fs.readdirSync(SCHEDULE_DIR).filter(f => f.endsWith('.json'));
  for (const file of files.sort().reverse()) {
    const plan = JSON.parse(fs.readFileSync(path.join(SCHEDULE_DIR, file), 'utf8'));
    if (plan.days && plan.days[dateStr]) return plan.days[dateStr];
  }
  return null;
}

function safeTrunc(str, max) {
  if (!str || str.length <= max) return str || '';
  const cut = str.slice(0, max + 1);
  const lastSpace = cut.lastIndexOf(' ');
  return lastSpace > 2 ? cut.slice(0, lastSpace) : str.slice(0, max);
}

async function main() {
  const { gerarTexto } = require('./lib/ai-helper.cjs');

  const dateStr = new Date().toISOString().slice(0, 10);
  const dayPlan = findDayPlan(dateStr);
  const reelKling = dayPlan?.reel_kling;

  if (!reelKling) { console.error('Nenhum plano para hoje.'); process.exit(1); }

  console.log('\n' + '═'.repeat(50));
  console.log('PREVIEW HOOK — ' + dateStr);
  console.log('Tema: ' + reelKling.topic);
  console.log('═'.repeat(50));

  const prompt = `Você é o melhor copywriter de Instagram do Brasil especializado em fitness feminino.

Crie 4 frases de hook para queimar em um Reel de 10 segundos de @leandro_personall (personal trainer para mulheres).
Cada frase aparece por 2.5 segundos — precisa ser impactante o suficiente para a pessoa parar o dedo e comentar.

Tema: "${reelKling.topic}"
Contexto: "${(reelKling.caption || '').slice(0, 150)}"

ESCOLHA um destes estilos (o mais impactante para o tema):

ESTILO A — Dor + Diagnóstico Chocante (revela algo que ela nunca percebeu):
Exemplo:
  "Você malha todo dia"
  "e ainda não emagrece."
  "O problema não é esforço."
  "Isso muda tudo."

ESTILO B — Acusação Social (faz ela pensar em alguém conhecido):
Exemplo:
  "Sua amiga emagreceu"
  "sem malhar mais."
  "Foi isso que ela mudou."
  "E você não sabe."

ESTILO C — Segredo + Traição (faz ela questionar o que aprendeu):
Exemplo:
  "Seu personal escondeu."
  "Não por maldade."
  "Funciona demais."
  "Assusta quem cobra R$300."

ESTILO D — Identidade + Provocação (mexe com quem ela acha que é):
Exemplo:
  "Você não é sedentária."
  "Nunca teve método real."
  "Método é isso."
  "Sedentária é quem para."

ESTRUTURA OBRIGATÓRIA — 4 segmentos, cada um com 3 linhas curtas (aparecem juntas por 2.5s):

Cada segmento = 3 linhas que formam uma ideia completa e impactante.

REGRAS ABSOLUTAS:
- EXATAMENTE 4 segmentos (s1 a s4)
- Cada linha: MÁXIMO 18 caracteres — rígido, sem exceção. Conte os caracteres antes de escrever. Prefira frases curtas e impactantes, nunca ultrapasse 18 caracteres incluindo espaços
- Use PT-BR correto com todos os acentos: ã, é, ê, ç, ô, etc.
- SEM emojis, SEM hashtags
- Tom: íntimo, direto, levemente provocativo — como uma amiga que sabe mais
- s1 deve fisgar atenção nos primeiros 2.5 segundos
- s4 é o fechamento: CTA CONVERSACIONAL genuíno — NÃO use "Comenta X aqui" ou "Salva esse post". Use perguntas como: "Você já conhecia isso?", "O que você acha?", "Já sentiu isso?", "Faz sentido pra você?"
- Cada linha deve fazer sentido sozinha E com as outras do segmento

Responda APENAS com JSON válido:
{
  "s1_l1": "máx 18 chars",
  "s1_l2": "máx 18 chars",
  "s1_l3": "máx 18 chars",
  "s2_l1": "máx 18 chars",
  "s2_l2": "máx 18 chars",
  "s2_l3": "máx 18 chars",
  "s3_l1": "máx 18 chars",
  "s3_l2": "máx 18 chars",
  "s3_l3": "máx 18 chars",
  "s4_l1": "pergunta CTA, máx 18 chars",
  "s4_l2": "",
  "s4_l3": ""
}`;

  const text  = await gerarTexto(prompt, 500);
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) { console.error('JSON inválido:', text); process.exit(1); }
  const p = JSON.parse(match[0]);

  const hook = [
    { l1: safeTrunc(p.s1_l1, 18), l2: safeTrunc(p.s1_l2, 18), l3: safeTrunc(p.s1_l3, 18) },
    { l1: safeTrunc(p.s2_l1, 18), l2: safeTrunc(p.s2_l2, 18), l3: safeTrunc(p.s2_l3, 18) },
    { l1: safeTrunc(p.s3_l1, 18), l2: safeTrunc(p.s3_l2, 18), l3: safeTrunc(p.s3_l3, 18) },
    { l1: safeTrunc(p.s4_l1, 18), l2: '', l3: '' }
  ];

  // Adiciona 5º segmento fixo — CTA descrição
  const hookWithCta = [...hook, { l1: 'Leia a descricao', l2: 'tem muito mais', l3: 'aqui embaixo!' }];
  const segDur = (10 / hookWithCta.length).toFixed(1);

  console.log('\n📽  PREVIEW — como vai aparecer no vídeo:\n');
  hookWithCta.forEach((seg, i) => {
    const start = (i * parseFloat(segDur)).toFixed(1);
    const end   = ((i + 1) * parseFloat(segDur)).toFixed(1);
    const label = i === hookWithCta.length - 1 ? ' ← CTA DESCRIÇÃO (fixo)' : '';
    console.log(`  [CENA ${i+1}] ${start}s–${end}s${label}`);
    [seg.l1, seg.l2, seg.l3].filter(Boolean).forEach(l => {
      const chars = l.length;
      const warn  = chars > 18 ? ' ⚠️  LONGO!' : '';
      console.log(`    "${l}"  (${chars} chars)${warn}`);
    });
    console.log();
  });

  console.log('═'.repeat(50));
  console.log('Chars máximos por linha: 18');
  const allLines = hook.flatMap(s => [s.l1,s.l2,s.l3]).filter(Boolean);
  const maxLen = Math.max(...allLines.map(l => l.length));
  const overLimit = allLines.filter(l => l.length > 18);
  console.log(`Linha mais longa: ${maxLen} chars`);
  if (overLimit.length) console.log('⚠️  Linhas acima de 18:', overLimit);
  else console.log('✅ Todas as linhas dentro do limite!');
  console.log('═'.repeat(50));
}

main().catch(err => { console.error('ERRO:', err.message); process.exit(1); });
