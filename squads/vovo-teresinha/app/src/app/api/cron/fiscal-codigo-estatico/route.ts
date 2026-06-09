/**
 * FISCAL ARNOLD AUDITOR — Fiscal de Código Estático
 *
 * Lê todos os route.ts de /api/cron via GitHub API e passa ao Claude Haiku
 * para detectar bugs estáticos que só aparecem ao ler o código-fonte:
 *   - Colunas inexistentes nas queries (ex: usuarios.criado_em → não existe)
 *   - Tabelas inexistentes (ex: pagamentos → não existe)
 *   - Status com valor errado ('ativa' → deve ser 'ativo')
 *   - sql.unsafe() → inválido no Neon HTTP driver
 *   - Rotas de cron sem cronAutorizado(req)
 *   - Desestruturação sem null-check (const [x] = await sql`...` sem if(!x))
 *
 * Dedup: não roda se já analisou há menos de 4h.
 * Ao final: reporta ao gerente-codigo e dispara claude-revisor se houver bugs.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import Anthropic from "@anthropic-ai/sdk";

const APP  = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.ALERTA_GITHUB_TOKEN || "";
const REPO = "leandro-dev17/leandro-instagram-automation";
const BASE = "squads/vovo-teresinha/app/src";

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// ── Contexto de schema passado ao Claude ─────────────────────────────────────

const SCHEMA_CONTEXT = `
## Schema real do banco (Neon PostgreSQL — NÃO invente colunas)

### usuarios
Colunas: id, email, nome, senha_hash, tipo_usuario, trial_fim, plano, whatsapp, aceita_whatsapp, assinatura_id
tipo_usuario válidos: 'free' | 'trial' | 'premium' | 'admin' | 'aluna_leandro'
NÃO existem: criado_em, criada_em, created_at, trial_inicio

### receitas
Colunas: id, titulo, descricao, categoria, refeicao, ingredientes (jsonb), modo_preparo (jsonb), foto_url, tempo_preparo, created_at
NÃO existem: criado_em, data_criacao

### assinaturas
Colunas: id, usuario_id, plano, status, renovada_em, mp_preapproval_id, mp_payment_id, valor, criado_em
status válidos APENAS: 'ativo', 'cancelado', 'trial', 'expirada', 'pendente'
ERRADO: 'ativa', 'cancelada', 'active', 'cancelled'

### favoritos
Colunas: id, usuario_id, receita_id, criado_em
NÃO existe: created_at

### whatsapp_fila
Colunas: id, usuario_id, numero, mensagem, tipo, agendado_para, enviado (boolean), enviado_em, criado_em
NÃO existe: status (use enviado = true/false)

### falhas_agentes
Colunas: id, agente, erro, dados (jsonb), tentativas, resolvido (boolean), resolvido_em, criado_em

### app_configuracoes
Colunas: id, chave (unique), valor, atualizado_em

### planos_semanais, lista_compras, geladeira_ingredientes, push_subscriptions, afiliados, comissoes
Existem, mas sempre verifique se a coluna existe antes de usar.

## Regras Neon HTTP driver (@neondatabase/serverless)
- NUNCA use sql.unsafe() — o método não existe, vai quebrar em TypeScript
- NUNCA use sql.transaction() — não suportado
- Tagged template literals apenas: sql\`SELECT ...\`
- Para DDL dinâmico: neon([rawSQL] as unknown as TemplateStringsArray)
- Resultados são arrays; desestruturar const [x] = await sql\`...\` pode ser undefined se array vazio

## Regras de auth
- Toda rota GET/POST de cron DEVE começar com:
  if (!cronAutorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
`;

// ── GitHub API helpers ────────────────────────────────────────────────────────

async function ghFetch(path: string): Promise<Response> {
  return fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: {
      Authorization: `Bearer ${GITHUB_TOKEN}`,
      Accept: "application/vnd.github.v3+json",
    },
    signal: AbortSignal.timeout(10000),
  });
}

async function listarCrons(): Promise<string[]> {
  const r = await ghFetch(`${BASE}/app/api/cron`);
  if (!r.ok) throw new Error(`GitHub ${r.status} ao listar crons`);
  const dirs = await r.json() as Array<{ name: string; type: string }>;
  return dirs.filter(d => d.type === "dir").map(d => d.name);
}

async function lerRoute(nome: string): Promise<string | null> {
  try {
    const r = await ghFetch(`${BASE}/app/api/cron/${nome}/route.ts`);
    if (!r.ok) return null;
    const d = await r.json() as { content: string };
    return Buffer.from(d.content, "base64").toString("utf-8");
  } catch { return null; }
}

// ── Análise via Claude Haiku ──────────────────────────────────────────────────

type Finding = { arquivo: string; problema: string; trecho?: string };

async function analisarLote(
  arquivos: Array<{ nome: string; codigo: string }>
): Promise<Finding[]> {
  const bloco = arquivos
    .map(a => `=== ${a.nome}/route.ts ===\n${a.codigo.slice(0, 2500)}`)
    .join("\n\n");

  const resp = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 2048,
    messages: [{
      role: "user",
      content: `Você é um fiscal de código TypeScript/Next.js. Detecte APENAS bugs concretos (não sugestões).

${SCHEMA_CONTEXT}

Analise os arquivos abaixo. Para cada bug encontrado, retorne JSON no formato:
[{"arquivo":"nome-do-cron","problema":"descrição exata","trecho":"código problemático em até 80 chars"}]

Bugs válidos:
1. Coluna que NÃO existe no schema (ex: usuarios.criado_em)
2. Tabela que NÃO existe (ex: FROM pagamentos)
3. Status com valor errado (ex: status = 'ativa')
4. sql.unsafe() ou sql.transaction()
5. Rota de cron sem cronAutorizado(req) no início
6. Desestruturação de array sem verificar undefined (const [x] = await sql... onde x.campo é usado sem ?.)

Se não houver bugs, retorne [].
Responda APENAS com o JSON, sem explicação.

ARQUIVOS:
${bloco}`,
    }],
  });

  const text = resp.content[0].type === "text" ? resp.content[0].text.trim() : "[]";
  const match = text.match(/\[[\s\S]*\]/);
  if (!match) return [];

  try {
    return JSON.parse(match[0]) as Finding[];
  } catch { return []; }
}

// ── Handler principal ─────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  if (!GITHUB_TOKEN) {
    return NextResponse.json({ erro: "GITHUB_TOKEN não configurado no Vercel" }, { status: 500 });
  }

  const inicio = Date.now();

  try {
    // Dedup: só roda a cada 4h
    const dedupRows = await sql`
      SELECT atualizado_em FROM app_configuracoes
      WHERE chave = 'fiscal_estatico_ultima_rodada'
    ` as { atualizado_em: string }[];

    if (dedupRows.length > 0) {
      const diffH = (Date.now() - new Date(dedupRows[0].atualizado_em).getTime()) / 3600000;
      if (diffH < 4) {
        return NextResponse.json({
          ok: true,
          motivo: `Última análise há ${diffH.toFixed(1)}h — aguardando 4h`,
        });
      }
    }

    // Lista todos os crons do repositório
    const crons = await listarCrons();
    const todos: Finding[] = [];

    // Lê arquivos em lotes de 8 (respeita rate limit do GitHub)
    const LOTE_GH = 8;
    const LOTE_CLAUDE = 5;

    for (let i = 0; i < crons.length; i += LOTE_GH) {
      const loteCrons = crons.slice(i, i + LOTE_GH);

      const lidos = (
        await Promise.all(loteCrons.map(async nome => {
          const codigo = await lerRoute(nome);
          return codigo ? { nome, codigo } : null;
        }))
      ).filter((x): x is { nome: string; codigo: string } => x !== null);

      // Analisa em sub-lotes para o Claude
      for (let j = 0; j < lidos.length; j += LOTE_CLAUDE) {
        const subLote = lidos.slice(j, j + LOTE_CLAUDE);
        const findings = await analisarLote(subLote);
        todos.push(...findings);
      }
    }

    // Registra timestamp (dedup)
    await sql`
      INSERT INTO app_configuracoes (chave, valor, atualizado_em)
      VALUES ('fiscal_estatico_ultima_rodada', ${new Date().toISOString()}, NOW())
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW()
    `;

    const totalProblemas = todos.length;

    if (totalProblemas === 0) {
      await resolverFalhas("fiscal-codigo-estatico");
      return NextResponse.json({
        ok: true,
        arquivos_analisados: crons.length,
        problemas_encontrados: 0,
        duracao_ms: Date.now() - inicio,
      });
    }

    // Grava cada problema no banco
    for (const f of todos) {
      const msg = `[${f.arquivo}] ${f.problema}${f.trecho ? ` — \`${f.trecho.slice(0, 80)}\`` : ""}`;
      await reportarFalha("fiscal-codigo-estatico", msg, {
        tipo: "codigo_estatico",
        severidade: "alto",
        arquivo: f.arquivo,
        trecho: f.trecho,
      });
    }

    // Agrupa por arquivo para o relatório
    const porArquivo: Record<string, Finding[]> = {};
    for (const f of todos) {
      if (!porArquivo[f.arquivo]) porArquivo[f.arquivo] = [];
      porArquivo[f.arquivo].push(f);
    }

    const resumo = Object.entries(porArquivo)
      .map(([arq, fns]) =>
        `📁 <b>${arq}</b>\n` +
        fns.map(f => `  ❌ ${f.problema.slice(0, 100)}`).join("\n")
      )
      .join("\n\n");

    await enviarTelegram(
      `🔍 <b>Fiscal Código Estático — ${totalProblemas} bug(s) estático(s)</b>\n\n` +
      resumo.slice(0, 3500) +
      `\n\n📊 ${crons.length} arquivos | ⏱️ ${((Date.now() - inicio) / 1000).toFixed(1)}s\n` +
      `🤖 Gerente de Código acionado para priorizar correções.`
    );

    // Aciona gerente-codigo para escalar ao claude-revisor se necessário
    fetch(`${APP}/api/cron/gerente-codigo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        origem: "fiscal-codigo-estatico",
        alertas: todos.map(f => ({
          tipo: "codigo_estatico",
          mensagem: `[${f.arquivo}] ${f.problema}`,
          arquivo: f.arquivo,
        })),
      }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    return NextResponse.json({
      ok: true,
      arquivos_analisados: crons.length,
      problemas_encontrados: totalProblemas,
      por_arquivo: porArquivo,
      duracao_ms: Date.now() - inicio,
    });

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    await enviarTelegram(
      `🔴 <b>Fiscal Código Estático — ERRO</b>\n<code>${msg.slice(0, 300)}</code>`
    );
    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
