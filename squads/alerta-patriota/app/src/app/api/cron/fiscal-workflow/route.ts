/**
 * FISCAL WAGNER WORKFLOW — Monitora saúde dos jobs do GitHub Actions
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const GITHUB_TOKEN = process.env.GITHUB_TOKEN || process.env.ALERTA_GITHUB_TOKEN;
const REPO = "leandro-dev17/leandro-instagram-automation";

const JOBS_CRITICOS = ["Cards Visuais", "Márcio Crise", "Bernardo Resumidor"];

type WorkflowRun = {
  id: number;
  name: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  jobs_url: string;
};

type JobRun = {
  name: string;
  conclusion: string | null;
  html_url: string;
};

async function buscarUltimosRuns(): Promise<WorkflowRun[]> {
  const res = await fetch(
    `https://api.github.com/repos/${REPO}/actions/runs?per_page=5`,
    {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(10000),
    }
  );

  if (!res.ok) throw new Error(`GitHub API retornou ${res.status}`);

  const data = await res.json();
  return data.workflow_runs ?? [];
}

async function buscarJobsDoRun(jobsUrl: string): Promise<JobRun[]> {
  try {
    const res = await fetch(jobsUrl, {
      headers: {
        Authorization: `Bearer ${GITHUB_TOKEN}`,
        Accept: "application/vnd.github+json",
      },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) return [];
    const data = await res.json();
    return data.jobs ?? [];
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  if (!GITHUB_TOKEN) {
    return NextResponse.json({ ok: false, motivo: "GITHUB_TOKEN não configurado" });
  }

  const inicio = Date.now();

  try {
    const runs = await buscarUltimosRuns();
    const resumoRuns: Array<Record<string, unknown>> = [];
    const falhasJobCritico: Record<string, number> = {};

    for (const run of runs) {
      const jobs = await buscarJobsDoRun(run.jobs_url);

      const jobsFalhando = jobs
        .filter((j) => j.conclusion === "failure")
        .map((j) => j.name);

      for (const jobNome of jobsFalhando) {
        for (const critico of JOBS_CRITICOS) {
          if (jobNome.includes(critico)) {
            falhasJobCritico[critico] = (falhasJobCritico[critico] || 0) + 1;
          }
        }
      }

      resumoRuns.push({
        id: run.id,
        nome: run.name,
        status: run.status,
        conclusion: run.conclusion,
        criado_em: run.created_at,
        url: run.html_url,
        jobs_falhando: jobsFalhando,
      });
    }

    // Jobs críticos com 2+ falhas nos últimos 3 runs
    const jobresCriticos = Object.entries(falhasJobCritico).filter(([, n]) => n >= 2);
    const alertas: string[] = [];

    if (jobresCriticos.length > 0) {
      const lista = jobresCriticos
        .map(([nome, n]) => `${nome} (${n}/${runs.length} runs falhando)`)
        .join("\n");

      const urlsLogs = resumoRuns
        .filter((r) => r.conclusion === "failure")
        .slice(0, 2)
        .map((r) => r.url)
        .join("\n");

      const mensagemAlerta = `Jobs críticos falhando repetidamente:\n${lista}\n\nLogs:\n${urlsLogs}`;
      alertas.push(mensagemAlerta);

      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES ('workflow_falhando', 'critico', ${mensagemAlerta})
      `;

      await alertarTelegram(
        "🚨",
        "FISCAL WAGNER WORKFLOW — Jobs Críticos Falhando",
        mensagemAlerta
      );
    }

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'wagner-workflow',
        'verificar_github_actions',
        ${jobresCriticos.length > 0 ? "aviso" : "sucesso"},
        ${JSON.stringify({
          runs_verificados: runs.length,
          jobs_criticos_falhando: falhasJobCritico,
          alertas,
        })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: jobresCriticos.length === 0,
      runs_verificados: runs.length,
      jobs_criticos_falhando: falhasJobCritico,
      alertas,
      resumo_runs: resumoRuns,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "FISCAL WAGNER WORKFLOW — ERRO AO CONSULTAR GITHUB", String(err));
    await sql`
      INSERT INTO alertas (tipo, severidade, mensagem)
      VALUES ('workflow_erro_api', 'alto', ${`Erro ao consultar GitHub Actions: ${String(err)}`})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
