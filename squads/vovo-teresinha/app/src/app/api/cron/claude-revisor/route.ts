/**
 * CLAUDE REVISOR — Aplicador de Correções Automáticas (Nível 1 / Topo da cadeia)
 * Fluxo: recebe alertas → lê arquivo no GitHub → Groq/Cerebras gera fix → commita → redeploy Vercel.
 * Dedup: se já tentou 2x em 2h → escala para intervenção manual via Telegram.
 * Anthropic removido em 15/07/2026 (mesmo padrão do claude-revisor do Alerta Patriota, Fase 56):
 * a rede de segurança real não é o provedor, é a validação de compilação/tamanho abaixo.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";
import { gerarCodigo } from "@/lib/ai";
import * as ts from "typescript";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.ALERTA_GITHUB_TOKEN || "";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "";
const VERCEL_PROJECT = "prj_RtqsbSdxPMz81W2cr0tJyatRJGMv";
const VERCEL_TEAM = "team_JnDwQYGSI9RBjHyIygKLR56b";
const REPO = "leandro-dev17/leandro-instagram-automation";
const BASE = "squads/vovo-teresinha/app/src";

// Bloqueia commits que quebrariam o build antes de irem ao GitHub. Adicionado em 15/07/2026
// depois de encontrar lib/agente-falha.ts com 85 commits consecutivos deste agente se
// corrigindo (e se corrompendo) sem nenhuma validação — chegou a substituir o arquivo inteiro
// por um módulo alucinado sem os exports que os outros crons realmente importam.
function validarAntesDeCommitar(caminho: string, codigoNovo: string, codigoAntigo: string): { ok: boolean; motivo?: string } {
  if (codigoNovo.includes("```")) {
    return { ok: false, motivo: "markdown residual no código (cerca não removida)" };
  }
  if (codigoNovo.trim().length < codigoAntigo.trim().length * 0.5) {
    return { ok: false, motivo: "conteúdo novo tem menos da metade do tamanho original (risco de truncamento)" };
  }
  if (caminho.endsWith(".ts") || caminho.endsWith(".tsx")) {
    const resultado = ts.transpileModule(codigoNovo, {
      compilerOptions: {
        jsx: ts.JsxEmit.ReactJSX,
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2020,
      },
      reportDiagnostics: true,
    });
    const erros = (resultado.diagnostics || []).filter(d => d.category === ts.DiagnosticCategory.Error);
    if (erros.length > 0) {
      const msg = erros.map(e => ts.flattenDiagnosticMessageText(e.messageText, " ")).join("; ");
      return { ok: false, motivo: `erro de sintaxe TypeScript: ${msg.substring(0, 200)}` };
    }
    // Exports removidos = provável reescrita alucinada do módulo, não um fix pontual
    const exportsAntigos = [...codigoAntigo.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]);
    const exportsNovos = new Set([...codigoNovo.matchAll(/export\s+(?:async\s+)?(?:function|const)\s+(\w+)/g)].map(m => m[1]));
    const perdidos = exportsAntigos.filter(nome => !exportsNovos.has(nome));
    if (perdidos.length > 0) {
      return { ok: false, motivo: `removeria export(s) usados por outros arquivos: ${perdidos.join(", ")}` };
    }
  }
  return { ok: true };
}

// Só tenta corrigir automaticamente quando dá pra derivar o arquivo real da mensagem do
// alerta. codigo_schema, codigo_logica e codigo_performance são sintomas agregados (contagem,
// taxa, fila, coluna de tabela) sem NENHUMA referência a um arquivo de código — mapear cada um
// pra um arquivo fixo (como era antes) é um chute, e foi exatamente esse chute que corrompeu
// lib/agente-falha.ts em 85 commits seguidos (alertas de fila/latência não têm nada a ver com
// esse arquivo). Pra esses três tipos, claude-revisor agora escala direto pra revisão manual.

// codigo_seguranca: cada check de fiscal-codigo-seguranca testa uma rota real específica —
// mensagem vem como "[nome_do_check] motivo", mesmo formato do codigo_estatico.
const ARQUIVO_POR_CHECK_SEGURANCA: Record<string, string> = {
  cron_sem_secret_bloqueado:        `${BASE}/lib/auth-cron.ts`,
  cron_com_secret_funciona:         `${BASE}/lib/auth-cron.ts`,
  admin_sem_auth_bloqueado:         `${BASE}/app/api/admin/usuarios/route.ts`,
  favoritos_sem_auth_bloqueado:     `${BASE}/app/api/usuarios/favoritos/route.ts`,
  plano_semanal_sem_auth_bloqueado: `${BASE}/app/api/plano-semanal/route.ts`,
  lista_compras_sem_auth_bloqueado: `${BASE}/app/api/lista-compras/route.ts`,
  geladeira_sem_auth_bloqueado:     `${BASE}/app/api/geladeira/route.ts`,
  webhook_mp_valida_assinatura:     `${BASE}/app/api/webhook/mercadopago/route.ts`,
};

// Extrai o nome do cron do alerta estático: "[nome-do-cron] problema"
function extrairArquivoEstatico(mensagem: string): string | null {
  const m = mensagem.match(/^\[([^\]]+)\]/);
  return m ? `${BASE}/app/api/cron/${m[1]}/route.ts` : null;
}

// Extrai o check de segurança que falhou e resolve pro arquivo real da rota testada
function extrairArquivoSeguranca(mensagem: string): string | null {
  const m = mensagem.match(/^\[([^\]]+)\]/);
  return m ? ARQUIVO_POR_CHECK_SEGURANCA[m[1]] || null : null;
}

async function lerArquivoGitHub(path: string): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${path}`);
  const d = await r.json() as { content: string };
  return Buffer.from(d.content, "base64").toString("utf-8");
}

async function commitarFix(path: string, conteudo: string, mensagem: string): Promise<boolean> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) return false;
  const d = await r.json() as { sha: string };

  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: mensagem,
      content: Buffer.from(conteudo).toString("base64"),
      sha: d.sha,
    }),
    signal: AbortSignal.timeout(15000),
  });
  return res.ok;
}

async function redeploy(): Promise<boolean> {
  if (!VERCEL_TOKEN) return false;
  try {
    const r = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT}&teamId=${VERCEL_TEAM}&limit=1&target=production`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(10000) }
    );
    const d = await r.json() as { deployments?: Array<{ uid: string; name: string }> };
    const last = d.deployments?.[0];
    if (!last) return false;

    const deploy = await fetch(`https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM}&forceNew=1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: last.name, deploymentId: last.uid, target: "production" }),
      signal: AbortSignal.timeout(15000),
    });
    return deploy.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();

  try {
    const body = await req.json().catch(() => ({})) as {
      alertas?: Array<{ tipo: string; mensagem: string }>;
    };

    let alertas = body.alertas || [];

    // Se não vieram alertas no body, busca do banco
    if (alertas.length === 0) {
      const rows = await sql`
        SELECT agente AS tipo, erro AS mensagem FROM falhas_agentes
        WHERE agente IN (
          'fiscal-codigo-seguranca',
          'fiscal-codigo-schema',
          'fiscal-codigo-logica'
        )
          AND resolvido = false
          AND criado_em >= NOW() - INTERVAL '4 hours'
        ORDER BY criado_em ASC LIMIT 3
      ` as { tipo: string; mensagem: string }[];
      alertas = rows.map(r => ({
        tipo: r.tipo.replace("fiscal-codigo-", "codigo_"),
        mensagem: r.mensagem,
      }));
    }

    if (alertas.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas para corrigir" });
    }

    // Dedup: já tentou 2x nas últimas 2h?
    const [jaCorrigiu] = await sql`
      SELECT COUNT(*)::int AS tentativas FROM falhas_agentes
      WHERE agente = 'claude-revisor' AND criado_em > NOW() - INTERVAL '2 hours'
    `;
    if (Number(jaCorrigiu.tentativas) >= 2) {
      await alertarTelegram(
        "🚨",
        "CLAUDE REVISOR — FALHOU 2x — AÇÃO MANUAL NECESSÁRIA",
        `🤖 <b>Vovó Teresinha Bot</b>\n\nProblemas que não consegui corrigir:\n` +
        alertas.map(a => `• ${a.mensagem}`).join("\n") +
        `\n\n<b>Passos para resolver:</b>\n1. Abra o Claude Code\n2. Execute: /BioNexus Digital\n3. Descreva o problema acima para o BioNexus resolver`
      );
      return NextResponse.json({ ok: false, motivo: "Escalado para intervenção manual" });
    }

    // Determina arquivo principal a corrigir — só quando dá pra derivar com segurança da
    // mensagem do alerta (ver comentário acima de ARQUIVO_POR_CHECK_SEGURANCA). Nada de
    // fallback pra um arquivo fixo: se não dá pra saber qual arquivo é, não tenta adivinhar.
    const tipoAlerta = alertas[0].tipo;
    const arquivo =
      tipoAlerta === "codigo_estatico" ? extrairArquivoEstatico(alertas[0].mensagem) :
      tipoAlerta === "codigo_seguranca" ? extrairArquivoSeguranca(alertas[0].mensagem) :
      null; // codigo_schema / codigo_logica / codigo_performance: sintoma agregado, sem arquivo

    if (!arquivo) {
      await alertarTelegram(
        "🟡",
        "CLAUDE REVISOR — Sem arquivo derivável, revisão manual necessária",
        `Tipo: ${tipoAlerta}\n` +
        alertas.map(a => `❌ ${a.mensagem}`).join("\n") +
        `\n\n<b>Esse tipo de alerta é um sintoma agregado (métrica, contagem, tabela) e não ` +
        `aponta pra um arquivo específico — corrigir automaticamente aqui seria só um chute.</b>\n\n` +
        `<b>Passos para resolver:</b>\n1. Abra o Claude Code\n2. Execute: /BioNexus Digital\n3. Descreva o problema acima para o BioNexus resolver`
      );
      await sql`
        INSERT INTO falhas_agentes (agente, erro, dados, tentativas)
        VALUES ('claude-revisor', ${`sem arquivo derivável para ${tipoAlerta}`}, ${JSON.stringify({ tipoAlerta })}, 1)
      `;
      return NextResponse.json({ ok: false, motivo: "Sem arquivo derivável — escalado para revisão manual" });
    }

    // Lê arquivo do GitHub
    let codigoAtual = "";
    try {
      codigoAtual = await lerArquivoGitHub(arquivo);
    } catch (e) {
      await alertarTelegram("🔴", "CLAUDE REVISOR — Erro ao ler arquivo GitHub", String(e));
      return NextResponse.json({ erro: "Não conseguiu ler arquivo no GitHub" }, { status: 500 });
    }

    // Groq/Cerebras (Llama 3.3 70B) gera o fix — só com os alertas do MESMO tipo que gerou
    // `arquivo` acima. Alertas de outro tipo vindos no mesmo lote (ex: schema junto com
    // seguranca) não têm nada a ver com este arquivo e não devem entrar no prompt nem ser
    // marcados como resolvidos mais abaixo.
    const alertasDoTipo = alertas.filter(a => a.tipo === tipoAlerta);
    const problema = alertasDoTipo.map(a => a.mensagem).join("\n");
    const codigoCorrigido = (await gerarCodigo({
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: `Você é um engenheiro sênior do app Receitinhas da Vovó Teresinha (Next.js 16, Neon PostgreSQL, Vercel).

PROBLEMA DETECTADO:
${problema}

ARQUIVO ATUAL (${arquivo}):
\`\`\`typescript
${codigoAtual}
\`\`\`

Retorne APENAS o código TypeScript corrigido completo, sem explicação, sem markdown, sem \`\`\`.
O código deve compilar sem erros TypeScript.`,
      }],
    })).trim();
    if (!codigoCorrigido || codigoCorrigido.length < 50) {
      throw new Error("IA retornou código vazio ou muito curto");
    }

    // Remove cercas de markdown que o modelo às vezes adiciona mesmo quando instruído a não usar
    const codigoLimpo = codigoCorrigido.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "").trim();

    // Validação pré-commit: bloqueia código com markdown residual, truncado ou com erro de
    // sintaxe antes do PUT no GitHub (ver comentário de validarAntesDeCommitar acima)
    const validacao = validarAntesDeCommitar(arquivo, codigoLimpo, codigoAtual);
    if (!validacao.ok) {
      throw new Error(`Fix BLOQUEADO antes do commit (${validacao.motivo})`);
    }

    // Commita o fix no GitHub
    const commitMsg = `fix(auto): claude-revisor vovó corrige ${tipoAlerta}\n\nProblema: ${problema.substring(0, 100)}\n\nCo-Authored-By: Claude Revisor Vovó Teresinha <noreply@anthropic.com>`;
    const commitOk = await commitarFix(arquivo, codigoLimpo, commitMsg);
    const deployOk = commitOk ? await redeploy() : false;

    // Registra tentativa (usado no dedup)
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, tentativas)
      VALUES ('claude-revisor', ${`corrigiu ${tipoAlerta}`},
        ${JSON.stringify({ arquivo, commitOk, deployOk, tipoAlerta })}, 1)
    `;

    if (commitOk) {
      // Resolve só os alertas que este fix realmente endereçou (mesmo agente fiscal + mesma
      // mensagem processada no prompt acima). Antes marcava TODOS os alertas não resolvidos
      // de seguranca/schema/logica de uma vez, mesmo quando só um tipo (às vezes só um alerta)
      // tinha sido de fato corrigido — chegava a resolver falhas que nunca foram tocadas.
      // Neste ponto tipoAlerta só pode ser "codigo_estatico" ou "codigo_seguranca" (os outros
      // três tipos escalam antes, na checagem de `arquivo` null acima).
      const agenteFiscal = tipoAlerta === "codigo_estatico" ? "fiscal-codigo-estatico" : "fiscal-codigo-seguranca";
      await sql`
        UPDATE falhas_agentes
        SET resolvido = true, resolvido_em = NOW()
        WHERE agente = ${agenteFiscal}
          AND resolvido = false
          AND erro = ANY(${alertasDoTipo.map(a => a.mensagem)})
      `;

      await enviarTelegram(
        `✅ <b>Claude Revisor — Fix Aplicado</b>\n\n` +
        `📁 Arquivo: <code>${arquivo.split("/").pop()}</code>\n` +
        `🐛 Problema: ${problema.substring(0, 150)}\n` +
        `💾 Commit: ✅ | 🚀 Deploy: ${deployOk ? "✅" : "⚠️ iniciando"}\n` +
        `⏱️ ${Date.now() - inicio}ms\n\n` +
        `<i>Correção automática — Vovó Teresinha Bot</i>`
      );
    } else {
      await alertarTelegram(
        "🔴",
        "CLAUDE REVISOR — Commit falhou",
        `Arquivo: ${arquivo}\n${problema.substring(0, 150)}`
      );
    }

    return NextResponse.json({
      ok: commitOk,
      arquivo,
      deployOk,
      duracao_ms: Date.now() - inicio,
    });
  } catch (err) {
    await alertarTelegram("🔴", "CLAUDE REVISOR — ERRO INTERNO", String(err));
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, tentativas)
      VALUES ('claude-revisor', ${String(err).substring(0, 200)}, '{}', 1)
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
