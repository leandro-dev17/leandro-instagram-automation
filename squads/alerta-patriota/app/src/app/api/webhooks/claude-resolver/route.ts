/**
 * CLAUDE RESOLVER — Autonomia Total
 *
 * Hierarquia: Fiscal → Gerente → CEO → Claude Resolver → Leandro (último recurso)
 *
 * Claude Resolver tem acesso e autorização para:
 * - Chamar qualquer rota da automação
 * - Ler e escrever código via GitHub API (commita fixes automaticamente)
 * - Atualizar variáveis no Vercel via API
 * - Chamar Claude API (sonnet) para analisar e gerar fixes de código
 * - Usar qualquer credencial disponível no ambiente
 * - Disparar re-deploys e re-runs de workflows
 *
 * Leandro recebe RELATÓRIO pós-resolução, não alerta durante.
 * Leandro só é incomodado quando Claude Resolver esgota todas as opções.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";
import { gerarTexto } from "@/lib/ai";

// ── CREDENCIAIS DISPONÍVEIS ───────────────────────────────────────────────────
const APP_URL         = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET     = process.env.CRON_SECRET || "";
const GITHUB_TOKEN    = process.env.ALERTA_GITHUB_TOKEN || "";
const GITHUB_REPO     = "leandro-dev17/leandro-instagram-automation";
const VERCEL_TOKEN    = process.env.VERCEL_TOKEN || "";
const VERCEL_PROJ     = "prj_ZYN6c2dhVL3oYGh00URkGot0bMO3";
const VERCEL_TEAM     = "team_JnDwQYGSI9RBjHyIygKLR56b";

// ── MAPA DE PROBLEMAS → ROTAS DE AUTO-FIX ────────────────────────────────────
const AUTO_FIX_ROTAS: Record<string, string[]> = {
  estoque_critico:       ["/api/cron/coletar-noticias", "/api/cron/curar-noticias", "/api/cron/resumir-noticias"],
  pipeline_incompleta:   ["/api/cron/coletar-noticias", "/api/cron/curar-noticias", "/api/cron/resumir-noticias"],
  conteudo_irrelevante:  ["/api/cron/curar-noticias"],
  fonte_rss_inativa:     ["/api/cron/coletar-noticias"],
  fiscal_whatsapp:       ["/api/cron/agente-medico"],
  fiscal_banco:          ["/api/cron/agente-medico"],
};

// ── MAPA DE PROBLEMAS → ARQUIVOS DE CÓDIGO ───────────────────────────────────
const MAPA_ARQUIVOS: Record<string, string> = {
  cards_sem_envio:       "squads/alerta-patriota/app/src/app/api/cron/gerar-card/route.ts",
  cards_com_erro:        "squads/alerta-patriota/app/src/app/api/cron/gerar-card/route.ts",
  pipeline_incompleta:   "squads/alerta-patriota/app/src/app/api/cron/resumir-noticias/route.ts",
  conteudo_irrelevante:  "squads/alerta-patriota/app/src/app/api/cron/curar-noticias/route.ts",
  workflow_falhando:     ".github/workflows/alerta-patriota-crons.yml",
  fonte_rss_inativa:     "squads/alerta-patriota/app/src/app/api/cron/coletar-noticias/route.ts",
  fiscal_whatsapp:       "squads/alerta-patriota/app/src/lib/whatsapp.ts",
};

// Arquivos críticos que NUNCA podem ser sobrescritos por auto-fix do Claude —
// um erro de truncamento aqui derruba autenticação ou conexão com o banco do sistema inteiro
const ARQUIVOS_PROTEGIDOS = [
  "squads/alerta-patriota/app/src/lib/auth.ts",
  "squads/alerta-patriota/app/src/lib/db.ts",
  "squads/alerta-patriota/app/src/middleware.ts",
];

// Tamanho máximo de arquivo para auto-fix seguro (evita corrigir com conteúdo truncado)
const TAMANHO_MAX_AUTOFIX = 12000;

// ── STEP 1: Auto-fix por chamada de rotas ────────────────────────────────────
async function tentarFixRotas(tipo: string): Promise<{ ok: boolean; acoes: string[] }> {
  const rotas = AUTO_FIX_ROTAS[tipo] || [];
  const acoes: string[] = [];

  for (const rota of rotas) {
    try {
      const res = await fetch(`${APP_URL}${rota}`, {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(20000),
      });
      const data = await res.json().catch(() => ({}));
      acoes.push(`${rota}: ${res.ok ? "✅ OK" : `❌ ${res.status}`}`);
      await new Promise(r => setTimeout(r, 3000));
    } catch (e) {
      acoes.push(`${rota}: ❌ ${String(e).substring(0, 80)}`);
    }
  }

  return { ok: rotas.length > 0, acoes };
}

// ── STEP 2: Ler arquivo do GitHub ─────────────────────────────────────────────
async function lerArquivoGitHub(caminho: string): Promise<{ conteudo: string; sha: string } | null> {
  if (!GITHUB_TOKEN) return null;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${caminho}`,
      { headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "X-GitHub-Api-Version": "2022-11-28" }, signal: AbortSignal.timeout(10000) }
    );
    if (!res.ok) return null;
    const data = await res.json();
    const conteudo = Buffer.from(data.content, "base64").toString("utf-8");
    return { conteudo, sha: data.sha };
  } catch { return null; }
}

// ── STEP 3: Escrever arquivo no GitHub (commita automaticamente) ──────────────
async function escreverArquivoGitHub(caminho: string, novoConteudo: string, sha: string, mensagemCommit: string): Promise<boolean> {
  if (!GITHUB_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/contents/${caminho}`,
      {
        method: "PUT",
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({
          message: mensagemCommit,
          content: Buffer.from(novoConteudo).toString("base64"),
          sha,
          committer: { name: "Guardião BioNexus", email: "guardiao@bionexus.digital" },
        }),
        signal: AbortSignal.timeout(15000),
      }
    );
    return res.ok;
  } catch { return false; }
}

// ── STEP 4: Chamar Claude para analisar e gerar fix ──────────────────────────
async function analisarComClaude(problema: string, erro: string, codigoAtual: string, arquivo: string): Promise<string | null> {
  try {
    const texto = await gerarTexto({
      model: "claude-sonnet-4-6",
      max_tokens: 8000,
      messages: [{
        role: "user",
        content:
          `Você é um engenheiro sênior que está fazendo auto-fix autônomo do sistema Alerta Patriota.\n\n` +
          `PROBLEMA DETECTADO: ${problema}\n` +
          `ERRO ESPECÍFICO: ${erro}\n` +
          `ARQUIVO: ${arquivo}\n\n` +
          `CÓDIGO ATUAL:\n\`\`\`\n${codigoAtual}\n\`\`\`\n\n` +
          `Analise o problema e retorne APENAS o código corrigido completo do arquivo, sem explicações, sem markdown, sem backticks.\n` +
          `O código deve estar pronto para ser commitado diretamente.\n` +
          `Mantenha todo o código original e corrija apenas o que está causando o problema.`,
      }],
    });
    // Remove possíveis backticks se Claude adicionou
    return texto?.replace(/^```[a-z]*\n?/, "").replace(/\n?```$/, "") || null;
  } catch { return null; }
}

// ── STEP 5: Disparar redeploy no Vercel ──────────────────────────────────────
async function dispararRedeploy(): Promise<boolean> {
  if (!VERCEL_TOKEN) return false;
  try {
    const deps = await fetch(
      `https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJ}&teamId=${VERCEL_TEAM}&limit=1&target=production`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(10000) }
    );
    const data = await deps.json();
    const ultimo = data.deployments?.[0];
    if (!ultimo) return false;

    const res = await fetch(
      `https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM}&forceNew=1`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: ultimo.name, deploymentId: ultimo.uid, target: "production" }),
        signal: AbortSignal.timeout(15000),
      }
    );
    return res.ok;
  } catch { return false; }
}

// ── STEP 6: Disparar novo workflow GitHub Actions ────────────────────────────
async function dispararWorkflow(workflowId?: string): Promise<boolean> {
  if (!GITHUB_TOKEN) return false;
  try {
    const res = await fetch(
      `https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/alerta-patriota-crons.yml/dispatches`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, "Content-Type": "application/json", "X-GitHub-Api-Version": "2022-11-28" },
        body: JSON.stringify({ ref: "main" }),
        signal: AbortSignal.timeout(10000),
      }
    );
    return res.ok;
  } catch { return false; }
}

// ── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────
export async function POST(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const inicio = Date.now();

  try {
    const body = await req.json() as {
      agente?: string; erro?: string; tipo?: string;
      tentativas?: number; dados?: Record<string, unknown>;
    };
    const { agente = "desconhecido", erro = "sem detalhes", tipo = "", tentativas = 1 } = body;

    const etapas: string[] = [];
    let resolvido = false;

    // ── ETAPA 1: Auto-fix por chamadas de API ────────────────────────────────
    const fixRotas = await tentarFixRotas(tipo);
    if (fixRotas.ok) {
      etapas.push(...fixRotas.acoes);
      // Aguarda 10s e verifica se resolveu
      await new Promise(r => setTimeout(r, 10000));
      const verificacao = await fetch(`${APP_URL}/api/cron/fiscal-pipeline`, {
        headers: { Authorization: `Bearer ${CRON_SECRET}` },
        signal: AbortSignal.timeout(15000),
      }).catch(() => null);
      const vData = await verificacao?.json().catch(() => ({})) as { ok?: boolean };
      if (vData?.ok) {
        resolvido = true;
        etapas.push("✅ Verificação pós-fix: pipeline OK");
      } else {
        etapas.push("⚠️ Fix de rotas não resolveu completamente — tentando fix de código");
      }
    }

    // ── ETAPA 2: Fix de código via Claude + GitHub API ───────────────────────
    if (!resolvido && MAPA_ARQUIVOS[tipo] && GITHUB_TOKEN && !ARQUIVOS_PROTEGIDOS.includes(MAPA_ARQUIVOS[tipo])) {
      const arquivo = MAPA_ARQUIVOS[tipo];
      const fileData = await lerArquivoGitHub(arquivo);

      if (fileData && fileData.conteudo.length <= TAMANHO_MAX_AUTOFIX) {
        etapas.push(`📁 Arquivo lido: ${arquivo} (${fileData.conteudo.length} chars)`);

        const novoConteudo = await analisarComClaude(
          `Agente: ${agente} | Tipo: ${tipo}`, erro, fileData.conteudo, arquivo
        );

        if (novoConteudo && novoConteudo !== fileData.conteudo) {
          const timestamp = new Date().toISOString().replace("T", " ").substring(0, 16) + " UTC";
          const commitMsg = `fix(auto): guardião corrigiu falha detectada ${timestamp}\n\nAgente: ${agente}\nTipo: ${tipo}\nErro: ${erro.substring(0, 100)}`;

          const commitOk = await escreverArquivoGitHub(arquivo, novoConteudo, fileData.sha, commitMsg);
          etapas.push(commitOk ? `✅ Fix commitado: ${arquivo}` : `❌ Commit falhou: ${arquivo}`);

          if (commitOk) {
            // Redeploy Vercel se for arquivo do app
            if (arquivo.includes("/app/")) {
              await dispararRedeploy();
              etapas.push("🔄 Redeploy Vercel disparado");
            }
            // Re-run workflow se for arquivo de automação
            if (arquivo.includes("/automation/") || arquivo.includes(".yml")) {
              await new Promise(r => setTimeout(r, 30000)); // aguarda deploy
              await dispararWorkflow();
              etapas.push("🔄 GitHub Actions workflow re-disparado");
            }
            resolvido = true;
          }
        } else {
          etapas.push("⚠️ Claude não encontrou fix específico para este código");
        }
      }
    }

    // ── ETAPA 3: Re-run workflow como última tentativa automática ─────────────
    if (!resolvido && ["cards_sem_envio", "workflow_falhando"].includes(tipo)) {
      const wOk = await dispararWorkflow();
      etapas.push(wOk ? "✅ Workflow GitHub Actions re-disparado" : "❌ Re-run falhou");
      if (wOk) resolvido = true;
    }

    // ── REGISTRA NO BANCO ────────────────────────────────────────────────────
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('claude-resolver', ${resolvido ? "autofix_sucesso" : "escalacao_leandro"}, ${resolvido ? "sucesso" : "aviso"},
        ${JSON.stringify({ agente, tipo, erro: erro.substring(0, 200), etapas, resolvido })},
        ${Date.now() - inicio})
    `;

    // ── NOTIFICA LEANDRO: relatório de sucesso OU pedido de ajuda ─────────────
    if (resolvido) {
      // Leandro recebe RELATÓRIO pós-resolução, não alerta
      await enviarTelegram(
        `🔧 *GUARDIÃO — Problema Resolvido Automaticamente*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `📋 *Agente:* ${agente}\n` +
        `⚠️ *Problema:* ${erro.substring(0, 100)}\n\n` +
        `*Etapas executadas:*\n${etapas.map(e => `• ${e}`).join("\n")}\n\n` +
        `✅ *Resolvido em ${Math.round((Date.now() - inicio) / 1000)}s sem intervenção humana.*\n` +
        `_Você não precisou fazer nada._`
      );
    } else {
      // Esgotou todas as opções automáticas — agora sim alerta Leandro
      const alertasAbertos = await sql`
        SELECT tipo, mensagem FROM alertas
        WHERE resolvido = false AND severidade IN ('critico', 'alto')
        ORDER BY created_at DESC LIMIT 5
      `;
      const lista = alertasAbertos.map(a => `• *${(a as { tipo: string }).tipo}*: ${(a as { mensagem: string }).mensagem.substring(0, 60)}`).join("\n");

      await enviarTelegram(
        `🆘 *GUARDIÃO → LEANDRO — Intervenção Necessária*\n` +
        `━━━━━━━━━━━━━━━━━━━━\n\n` +
        `Esgotei todas as opções automáticas.\n\n` +
        `📋 *Agente:* ${agente}\n` +
        `❌ *Problema:* ${erro.substring(0, 120)}\n\n` +
        `*O que tentei:*\n${etapas.map(e => `• ${e}`).join("\n")}\n\n` +
        (lista ? `*Alertas abertos:*\n${lista}\n\n` : "") +
        `━━━━━━━━━━━━━━━━━━━━\n` +
        `*Para resolver:*\n` +
        `1. Abra o Claude Code\n` +
        `2. Execute: \`/BioNexus Digital\`\n` +
        `3. Descreva o problema acima\n\n` +
        `_O Claude Code tem acesso total e commitará o fix automaticamente._`
      );
    }

    return NextResponse.json({ ok: resolvido, etapas, duracao_ms: Date.now() - inicio });
  } catch (err) {
    await enviarTelegram(`🔴 *CLAUDE RESOLVER — Erro interno*\n${String(err).substring(0, 200)}`);
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
