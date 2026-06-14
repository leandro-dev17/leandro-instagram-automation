/**
 * CLAUDE REVISOR (Nível 1)
 * Usa a API da Anthropic para analisar e corrigir problemas de código automaticamente.
 * Fluxo: Recebe alertas → lê arquivo no GitHub → Claude gera fix → commita → redeploy Vercel.
 * Se falhar 2x → escala para Claude Resolver existente → notifica Leandro.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";
import { gerarTexto } from "@/lib/ai";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";
const GITHUB_TOKEN = process.env.ALERTA_GITHUB_TOKEN || "";
const VERCEL_TOKEN = process.env.VERCEL_TOKEN || "";
const VERCEL_PROJECT = "prj_ZYN6c2dhVL3oYGh00URkGot0bMO3";
const VERCEL_TEAM = "team_JnDwQYGSI9RBjHyIygKLR56b";
const REPO = "leandro-dev17/leandro-instagram-automation";
const BASE = "squads/alerta-patriota/app/src";

// Mapa: tipo de alerta → arquivo mais provável para corrigir
const ARQUIVO_POR_TIPO: Record<string, string> = {
  "codigo_seguranca": `${BASE}/lib/auth.ts`,
  "codigo_schema": `${BASE}/app/api/admin/setup/route.ts`,
  "codigo_logica": `${BASE}/app/api/cron/resumir-noticias/route.ts`,
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
    signal: AbortSignal.timeout(10000),
  });
  if (!r.ok) throw new Error(`GitHub ${r.status}: ${path}`);
  const d = await r.json();
  return Buffer.from(d.content, "base64").toString("utf-8");
}

async function commitarFix(path: string, conteudo: string, mensagem: string): Promise<boolean> {
  // Pega SHA atual do arquivo
  const r = await fetch(`https://api.github.com/repos/${REPO}/contents/${path}`, {
    headers: { Authorization: `Bearer ${GITHUB_TOKEN}`, Accept: "application/vnd.github.v3+json" },
    signal: AbortSignal.timeout(10000),
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
    signal: AbortSignal.timeout(15000),
  });
  return res.ok;
}

async function redeploy(): Promise<boolean> {
  if (!VERCEL_TOKEN) return false;
  try {
    const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT}&teamId=${VERCEL_TEAM}&limit=1&target=production`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(10000),
    });
    const d = await r.json();
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
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

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

    // Verifica se já tentou corrigir e falhou recentemente (dedup)
    const jaCorrigiu = await sql`
      SELECT id FROM agentes_log WHERE agente = 'claude-revisor'
      AND status = 'erro'
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

    // Determina o arquivo principal a corrigir
    const tipoAlerta = alertas[0].tipo;
    const arquivo = ARQUIVO_POR_TIPO[tipoAlerta];

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
    const codigoCorrigido = await gerarTexto({
      model: "claude-haiku-4-5-20251001",
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

    // Commita o fix
    const commitMsg = `fix(auto): claude-revisor corrige ${tipoAlerta}\n\nProblemas: ${problema.substring(0, 100)}\n\nCo-Authored-By: Claude Revisor <noreply@anthropic.com>`;
    const commitOk = await commitarFix(arquivo, codigoCorrigido, commitMsg);

    // Redeploy
    const deployOk = commitOk ? await redeploy() : false;

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
