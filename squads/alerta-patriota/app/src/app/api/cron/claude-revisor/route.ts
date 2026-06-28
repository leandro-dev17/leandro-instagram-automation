/**
 * CLAUDE REVISOR (Nível 1)
 * Usa a API da Anthropic para analisar e corrigir problemas de código automaticamente.
 * Fluxo: Recebe alertas → lê arquivo no GitHub → Claude gera fix → commita → redeploy Vercel.
 * Se falhar 2x → escala para Claude Resolver existente → notifica Leandro.
 *
 * ⚠️ ATENÇÃO — INCIDENTE 19-20/06/2026: este agente já recorrompeu resumir-noticias/route.ts
 * 2x (commits 44d585b e 3f1858d) sobrescrevendo o arquivo com código truncado/inválido antes
 * do fix de strip de markdown (linhas 199-204) existir. SEMPRE revisar manualmente todo commit
 * "fix(auto): claude-revisor corrige ..." no GitHub (autor Claude Revisor) antes de confiar nele:
 * confirmar que o arquivo resultante compila (tsc --noEmit) e que o tamanho não encolheu de forma
 * suspeita. Ver squads/alerta-patriota/PLANO-CORRECAO.md (Fase 7) para o histórico completo.
 */
import { NextRequest, NextResponse } from "next/server";
import * as ts from "typescript";
import { sql } from "@/lib/db";
import { verificarSegredoAutofix } from "@/lib/auth";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";
import { gerarCodigoComClaude } from "@/lib/ai";

// Plano Hobby da Vercel mata a função em 10s por padrão, e a cadeia de fallback Groq→Cerebras→Anthropic pode levar mais que isso
export const maxDuration = 60;
// Os 4 fetches fixos (ler arquivo, ler SHA, commit, redeploy) já somavam até 50s de timeout
// declarado, sobrando quase nada para a chamada de IA (a etapa mais lenta e variável) antes
// de bater no teto de 60s do plano Hobby. ORCAMENTO_MS pula o redeploy (não-essencial — o
// commit já resolve o alerta; o próximo push/deploy natural cobre isso) se o tempo já
// estiver no limite, em vez de arriscar a function ser matada no meio do POST.
const ORCAMENTO_MS = 45000;

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";
const GITHUB_TOKEN = process.env.ALERTA_GITHUB_TOKEN || "";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "";
const VERCEL_PROJECT = "prj_ZYN6c2dhVL3oYGh00URkGot0bMO3";
const VERCEL_TEAM = "team_JnDwQYGSI9RBjHyIygKLR56b";
const REPO = "leandro-dev17/leandro-instagram-automation";
const BASE = "squads/alerta-patriota/app/src";

// Mapa: tipo de alerta → arquivo mais provável para corrigir.
// FASE 27.6: "codigo_logica" foi removido deste mapa. fiscal-codigo-logica/route.ts agrupa
// 6 categorias de problema completamente não relacionadas (coletor parado, resumidor parado,
// 4 agentes diferentes sem rodar, limite de cards excedido, alertas críticos acumulados,
// publicações duplicadas) sob o mesmo tipo de alerta "codigo_logica" — mas este mapa sempre
// apontava para o mesmo arquivo hardcoded (resumir-noticias/route.ts), que só é a causa real
// em 1 dessas 6 categorias. Nas outras 5, o auto-fix editaria um arquivo correto/não relacionado
// enquanto o bug real (em coletar-noticias, gerador-card, etc.) ficava sem correção. Sem entrada
// no mapa, esse tipo cai automaticamente no branch "tipo sem mapeamento seguro" (linha abaixo) e
// escala direto para revisão humana, no mesmo espírito de ARQUIVOS_PROTEGIDOS.
const ARQUIVO_POR_TIPO: Record<string, string> = {
  "codigo_seguranca": `${BASE}/lib/auth.ts`,
  "codigo_schema": `${BASE}/app/api/admin/setup/route.ts`,
};

// Arquivos críticos que NUNCA podem ser sobrescritos por auto-fix do Claude —
// um erro de truncamento aqui derruba autenticação ou conexão com o banco do sistema inteiro
const ARQUIVOS_PROTEGIDOS = [
  `${BASE}/lib/auth.ts`,
  `${BASE}/lib/db.ts`,
  `${BASE}/middleware.ts`,
];

// Tamanho máximo de arquivo para auto-fix seguro (evita corrigir com conteúdo truncado)
const TAMANHO_MAX_AUTOFIX = 6000;

async function lerArquivoGitHub(path: string): Promise<string> {
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${path}`);
  const d = await r.json();
  return Buffer.from(d.content, "base64").toString("utf-8");
}

async function commitarFix(path: string, conteudo: string, mensagem: string): Promise<boolean> {
  // Pega SHA atual do arquivo
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(6000),
  });
  if (!r.ok) return false;
  const d = await r.json();

  // Commita o fix
  const res = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      message: mensagem,
      content: Buffer.from(conteudo).toString("base64"),
      sha: d.sha,
    }),
    signal: AbortSignal.timeout(10000),
  });
  return res.ok;
}

// FASE 21: este agente já recorrompeu resumir-noticias/route.ts 2x (ver aviso no topo do
// arquivo) porque o único filtro pré-commit era "tem cerca de markdown / tamanho < 50
// chars". Replica a mesma checagem de sintaxe TypeScript que o claude-resolver já tem,
// bloqueando o commit se o código novo não compilar ou tiver encolhido de forma suspeita.
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
  }
  return { ok: true };
}

async function redeploy(): Promise<boolean> {
  if (!VERCEL_TOKEN) return false;
  try {
    const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT}&teamId=${VERCEL_TEAM}&limit=1&target=production`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(6000),
    });
    const d = await r.json();
    const last = d.deployments?.[0];
    if (!last) return false;

    const deploy = await fetch(`https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM}&forceNew=1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: last.name, deploymentId: last.uid, target: "production" }),
      signal: AbortSignal.timeout(10000),
    });
    return deploy.ok;
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  if (!verificarSegredoAutofix(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    const body = await req.json() as { alertas?: Array<{ tipo: string; mensagem: string }> };
    const alertas = body.alertas || [];

    if (alertas.length === 0) {
      // Busca alertas não resolvidos se não vieram no body
      const rows = await sql`
        SELECT tipo, mensagem FROM alertas
        WHERE tipo IN ('codigo_seguranca', 'codigo_schema', 'codigo_logica')
        AND resolvido = false AND created_at >= NOW() - INTERVAL '4 hours'
        ORDER BY CASE severidade WHEN 'critico' THEN 0 WHEN 'alto' THEN 1 ELSE 2 END
        LIMIT 3
      `;
      alertas.push(...rows.map(r => ({ tipo: r.tipo as string, mensagem: r.mensagem as string })));
    }

    if (alertas.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas para corrigir" });
    }

    // Determina o arquivo principal a corrigir
    const tipoAlerta = alertas[0].tipo;
    const arquivo = ARQUIVO_POR_TIPO[tipoAlerta];

    // FASE 30: o dedup original só contava tentativas com status='erro' — um commit que
    // "teve sucesso" (commitOk=true) mas não corrigiu o problema de fato (ver INCIDENTE
    // 19-20/06/2026 no topo do arquivo: resumir-noticias/route.ts recorrompido 2x, ambas
    // as vezes logado como 'sucesso') nunca incrementava esse contador. Resultado: o mesmo
    // tipoAlerta podia reaparecer e ser "corrigido" indefinidamente sem nunca escalar para
    // revisão humana. Agora conta qualquer tentativa anterior (sucesso OU erro) para o
    // MESMO tipoAlerta: se o alerta voltou depois de uma tentativa anterior, essa tentativa
    // não resolveu de verdade.
    const jaCorrigiu = await sql`
      SELECT id FROM agentes_log WHERE agente = 'claude-revisor'
      AND detalhes->>'tipoAlerta' = ${tipoAlerta}
      AND created_at > NOW() - INTERVAL '1 hour'
    `;
    const tentativas = jaCorrigiu.length;

    if (tentativas >= 2) {
      // Escalação final: Claude Resolver + notifica Leandro
      await alertarTelegram("🚨", "CLAUDE REVISOR — FALHOU 2x — ESCALANDO PARA CLAUDE RESOLVER",
        `Problemas:\n${alertas.map(a => `• ${a.mensagem}`).join("\n")}\n\n1. Abra o Claude Code\n2. Execute: /BioNexus Digital\n3. Descreva o problema acima`
      );
      await fetch(`${APP}/api/cron/escalar-claude`, {
        headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      return NextResponse.json({ ok: false, motivo: "Escalado para Claude Resolver" });
    }

    // Arquivo crítico (auth/db/middleware) ou tipo sem mapeamento seguro → não faz auto-fix, escala direto
    if (!arquivo || ARQUIVOS_PROTEGIDOS.includes(arquivo)) {
      await alertarTelegram("🚨", "CLAUDE REVISOR — Arquivo protegido, escalando para revisão manual",
        `Tipo: ${tipoAlerta}\nArquivo: ${arquivo || "(sem mapeamento)"}\n\nProblemas:\n${alertas.map(a => `• ${a.mensagem}`).join("\n")}\n\n1. Abra o Claude Code\n2. Execute: /BioNexus Digital\n3. Descreva o problema acima`
      );
      await fetch(`${APP}/api/cron/escalar-claude`, {
        headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      return NextResponse.json({ ok: false, motivo: "Arquivo protegido — escalado para revisão manual" });
    }

    // Lê o arquivo atual
    let codigoAtual = "";
    try {
      codigoAtual = await lerArquivoGitHub(arquivo);
    } catch (e) {
      await alertarTelegram("🔴", "CLAUDE REVISOR — Erro ao ler arquivo", String(e));
      return NextResponse.json({ erro: "Não conseguiu ler arquivo" }, { status: 500 });
    }

    // Arquivo muito grande para corrigir com segurança (truncamento corromperia o commit)
    if (codigoAtual.length > TAMANHO_MAX_AUTOFIX) {
      await alertarTelegram("🚨", "CLAUDE REVISOR — Arquivo grande demais para auto-fix, escalando",
        `Arquivo: ${arquivo} (${codigoAtual.length} caracteres)\n\nProblemas:\n${alertas.map(a => `• ${a.mensagem}`).join("\n")}\n\n1. Abra o Claude Code\n2. Execute: /BioNexus Digital\n3. Descreva o problema acima`
      );
      await fetch(`${APP}/api/cron/escalar-claude`, {
        headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
      }).catch(() => {});
      return NextResponse.json({ ok: false, motivo: "Arquivo grande demais — escalado para revisão manual" });
    }

    // Claude analisa e gera o fix
    const problema = alertas.map(a => a.mensagem).join("\n");
    const codigoCorrigido = await gerarCodigoComClaude({
      model: "claude-haiku-4-5-20251001",
      agente: "claude-revisor",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content: `Você é um engenheiro sênior. Corrija este código TypeScript/Next.js.

PROBLEMA DETECTADO:
${problema}

ARQUIVO ATUAL (${arquivo}):
\`\`\`typescript
${codigoAtual}
\`\`\`

Retorne APENAS o código TypeScript corrigido completo, sem explicação, sem markdown, sem \`\`\`.
O código deve ser válido e compilar sem erros.`,
      }],
    });

    if (!codigoCorrigido || codigoCorrigido.length < 50) {
      throw new Error("Claude retornou código vazio ou muito curto");
    }

    // Remove cercas de markdown que o modelo às vezes adiciona mesmo quando instruído a não usar
    const codigoLimpo = codigoCorrigido.replace(/^```[a-zA-Z]*\n?/, "").replace(/\n?```\s*$/, "").trim();

    // Sanidade: se ainda sobrou alguma cerca no meio do conteúdo, o resultado não é código puro — não commita
    if (codigoLimpo.includes("```") || codigoLimpo.length < 50) {
      throw new Error("Claude retornou código com markdown residual — commit abortado por segurança");
    }

    // Validação pré-commit: bloqueia código com erro de sintaxe ou truncado antes do PUT no GitHub
    const validacao = validarAntesDeCommitar(arquivo, codigoLimpo, codigoAtual);
    if (!validacao.ok) {
      throw new Error(`Fix BLOQUEADO antes do commit (${validacao.motivo})`);
    }

    // Commita o fix
    const commitMsg = `fix(auto): claude-revisor corrige ${tipoAlerta}\n\nProblemas: ${problema.substring(0, 100)}\n\nCo-Authored-By: Claude Revisor <noreply@anthropic.com>`;
    const commitOk = await commitarFix(arquivo, codigoLimpo, commitMsg);

    // Redeploy — pulado se o orçamento já estiver no limite (commit já resolve o alerta;
    // o próximo deploy natural do projeto sobe esse código de qualquer forma)
    const deployOk = commitOk && Date.now() - inicio < ORCAMENTO_MS ? await redeploy() : false;

    // Registra
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('claude-revisor', 'corrigir_codigo', ${commitOk ? "sucesso" : "erro"},
        ${JSON.stringify({ arquivo, tipoAlerta, commitOk, deployOk, problema: problema.substring(0, 200) })},
        ${Date.now() - inicio})
    `;

    if (commitOk) {
      // Resolve alertas
      await sql`
        UPDATE alertas SET resolvido = true, resolvido_at = NOW()
        WHERE tipo = ${tipoAlerta} AND resolvido = false
      `;

      await enviarTelegram(
        `✅ *CLAUDE REVISOR — FIX APLICADO*\n\nArquivo: ${arquivo.split("/").pop()}\nProblema: ${problema.substring(0, 150)}\nCommit: ✅ | Deploy: ${deployOk ? "✅" : "⚠️ iniciado"}\n\n_Correção automática aplicada com sucesso._`
      );
    } else {
      await alertarTelegram("🔴", "CLAUDE REVISOR — Commit falhou", `Arquivo: ${arquivo}\n${problema.substring(0, 150)}`);
    }

    return NextResponse.json({ ok: commitOk, arquivo, deployOk });
  } catch (err) {
    await alertarTelegram("🔴", "CLAUDE REVISOR — ERRO INTERNO", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('claude-revisor', 'corrigir_codigo', 'erro',
        ${JSON.stringify({ erro: String(err).substring(0, 200) })},
        ${Date.now() - inicio})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}

// GET para trigger manual
export async function GET(req: NextRequest) {
  return POST(req);
}
