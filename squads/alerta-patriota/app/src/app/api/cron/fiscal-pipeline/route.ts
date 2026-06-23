import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram, alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

type Ciclo = "manha" | "tarde" | "noite";

type JanelaCiclo = {
  ciclo: Ciclo;
  label: string;
  inicioUTC: number;
  fimUTC: number;
};

type StatusStep = {
  ok: boolean;
  encontrado: boolean;
};

type StatusCiclo = {
  ciclo: Ciclo;
  ativo: boolean;
  neto: StatusStep;
  carlos: StatusStep;
  bernardo: StatusStep;
  card: StatusStep;
  completo: boolean;
};

function agoraHoraBRT(): number {
  const agora = new Date();
  const brt = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return brt.getHours() + brt.getMinutes() / 60;
}

function dataHojeBRT(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function janelasUTCHoje(): JanelaCiclo[] {
  const hoje = dataHojeBRT();
  return [
    {
      ciclo: "manha",
      label: "Manhã (6h-12h BRT)",
      // 05:30 BRT = 08:30 UTC | 08:30 BRT = 11:30 UTC
      inicioUTC: new Date(`${hoje}T08:30:00Z`).getTime(),
      fimUTC: new Date(`${hoje}T11:30:00Z`).getTime(),
    },
    {
      ciclo: "tarde",
      label: "Tarde (12h-18h BRT)",
      // 11:30 BRT = 14:30 UTC | 14:30 BRT = 17:30 UTC
      inicioUTC: new Date(`${hoje}T14:30:00Z`).getTime(),
      fimUTC: new Date(`${hoje}T17:30:00Z`).getTime(),
    },
    {
      ciclo: "noite",
      label: "Noite (18h+ BRT)",
      // 17:30 BRT = 20:30 UTC | 20:30 BRT = 23:30 UTC
      inicioUTC: new Date(`${hoje}T20:30:00Z`).getTime(),
      fimUTC: new Date(`${hoje}T23:30:00Z`).getTime(),
    },
  ];
}

function ciclosQueJaDeveriamTerOcorrido(horaBRT: number): Ciclo[] {
  const ciclos: Ciclo[] = [];
  if (horaBRT >= 8.5) ciclos.push("manha");
  if (horaBRT >= 14.5) ciclos.push("tarde");
  if (horaBRT >= 20.5) ciclos.push("noite");
  return ciclos;
}

async function verificarStepNoBanco(
  agente: string,
  acaoLike: string | null,
  inicioUTC: number,
  fimUTC: number,
  exato: boolean
): Promise<boolean> {
  const inicio = new Date(inicioUTC).toISOString();
  const fim = new Date(fimUTC).toISOString();

  let rows;
  if (exato) {
    rows = await sql`
      SELECT id FROM agentes_log
      WHERE agente = ${agente}
        AND status = 'sucesso'
        AND created_at >= ${inicio}::timestamptz
        AND created_at <= ${fim}::timestamptz
      LIMIT 1
    `;
  } else {
    rows = await sql`
      SELECT id FROM agentes_log
      WHERE agente = ${agente}
        AND acao LIKE ${acaoLike}
        AND status = 'sucesso'
        AND created_at >= ${inicio}::timestamptz
        AND created_at <= ${fim}::timestamptz
      LIMIT 1
    `;
  }

  return rows.length > 0;
}

const COOLDOWN_AUTOFIX_MS = 60 * 60 * 1000; // 1h: evita re-disparar o mesmo step em loop

async function jaTentouRecentemente(step: string, ciclo: Ciclo): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM agentes_log
    WHERE agente = 'mateus-manchete'
      AND acao = ${`auto_fix_${step}_${ciclo}`}
      AND created_at >= NOW() - INTERVAL '1 hour'
    LIMIT 1
  `;
  return rows.length > 0;
}

async function tentarAutoFix(stepsEmFalta: string[], ciclo: Ciclo): Promise<Record<string, string>> {
  const resultado: Record<string, string> = {};
  const headers = {
    Authorization: `Bearer ${CRON_SECRET}`,
    "Content-Type": "application/json",
  };

  const rotasPorStep: Record<string, string> = {
    "neto-noticias": `${APP_URL}/api/cron/coletar-noticias`,
    "curador-carlos": `${APP_URL}/api/cron/curar-noticias`,
    "bernardo-resumidor": `${APP_URL}/api/cron/resumir-noticias`,
  };

  const ordemExecucao = ["neto-noticias", "curador-carlos", "bernardo-resumidor"];

  for (const step of ordemExecucao) {
    if (!stepsEmFalta.includes(step)) continue;
    const rota = rotasPorStep[step];
    if (!rota) continue;

    if (await jaTentouRecentemente(step, ciclo)) {
      resultado[step] = "pulado_cooldown";
      continue;
    }

    try {
      const res = await fetch(rota, { method: "GET", headers, signal: AbortSignal.timeout(30000) });
      resultado[step] = res.ok ? "chamado" : `erro_${res.status}`;
    } catch (e) {
      resultado[step] = `falhou: ${String(e).slice(0, 80)}`;
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('mateus-manchete', ${`auto_fix_${step}_${ciclo}`}, 'sucesso', ${JSON.stringify({ resultado: resultado[step] })})
    `.catch(() => {});

    await new Promise((r) => setTimeout(r, 3000));
  }

  return resultado;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const horaBRT = agoraHoraBRT();
  const janelas = janelasUTCHoje();
  const ciclosPendentes = ciclosQueJaDeveriamTerOcorrido(horaBRT);
  const resultados: StatusCiclo[] = [];
  const ciclosIncompletos: StatusCiclo[] = [];

  try {
    for (const janela of janelas) {
      const ativo = ciclosPendentes.includes(janela.ciclo);

      const [neto, carlos, bernardo, card] = await Promise.all([
        verificarStepNoBanco("neto-noticias", null, janela.inicioUTC, janela.fimUTC, true),
        verificarStepNoBanco("curador-carlos", null, janela.inicioUTC, janela.fimUTC, true),
        verificarStepNoBanco("bernardo-resumidor", null, janela.inicioUTC, janela.fimUTC, true),
        verificarStepNoBanco("gerador-card", "card_%", janela.inicioUTC, janela.fimUTC, false),
      ]);

      const statusCiclo: StatusCiclo = {
        ciclo: janela.ciclo,
        ativo,
        neto: { ok: neto, encontrado: neto },
        carlos: { ok: carlos, encontrado: carlos },
        bernardo: { ok: bernardo, encontrado: bernardo },
        card: { ok: card, encontrado: card },
        completo: neto && carlos && bernardo && card,
      };

      resultados.push(statusCiclo);

      if (ativo && !statusCiclo.completo) {
        ciclosIncompletos.push(statusCiclo);
      }
    }

    if (ciclosIncompletos.length > 0) {
      for (const cicloFalho of ciclosIncompletos) {
        const stepsEmFalta: string[] = [];
        if (!cicloFalho.neto.ok) stepsEmFalta.push("neto-noticias");
        if (!cicloFalho.carlos.ok) stepsEmFalta.push("curador-carlos");
        if (!cicloFalho.bernardo.ok) stepsEmFalta.push("bernardo-resumidor");

        const cicloLabel: Record<Ciclo, string> = {
          manha: "Manhã (6h-12h BRT)",
          tarde: "Tarde (12h-18h BRT)",
          noite: "Noite (18h+ BRT)",
        };

        const autoFixResult = stepsEmFalta.length > 0
          ? await tentarAutoFix(stepsEmFalta, cicloFalho.ciclo)
          : {};

        const mensagemAlerta = `Pipeline incompleta no ciclo ${cicloLabel[cicloFalho.ciclo]}. Steps em falta: ${stepsEmFalta.join(", ") || "nenhum (card pendente)"}. Auto-fix: ${JSON.stringify(autoFixResult)}`;

        const { criado } = await criarAlertaDedup("pipeline_incompleta", "critico", mensagemAlerta);

        const linhas = [
          `🔴 MATEUS MANCHETE — Pipeline Incompleta`,
          `Ciclo: ${cicloLabel[cicloFalho.ciclo]}`,
          ``,
          `${cicloFalho.neto.ok ? "✅" : "❌"} Neto Notícias: ${cicloFalho.neto.ok ? "OK" : "não executou"}`,
          `${cicloFalho.carlos.ok ? "✅" : "❌"} Curador Carlos: ${cicloFalho.carlos.ok ? "OK" : "não executou"}`,
          `${cicloFalho.bernardo.ok ? "✅" : "❌"} Bernardo Resumidor: ${cicloFalho.bernardo.ok ? "OK" : "não executou"}`,
          `${cicloFalho.card.ok ? "✅" : "❌"} Gerador de Card: ${cicloFalho.card.ok ? "OK" : "não executou"}`,
          ``,
        ];

        if (stepsEmFalta.length > 0) {
          linhas.push(`Auto-fix: tentei chamar ${stepsEmFalta.map((s) => s.replace("neto-noticias", "coletar-noticias").replace("curador-carlos", "curar-noticias").replace("bernardo-resumidor", "resumir-noticias")).join(" e ")}.`);
        } else {
          linhas.push(`Auto-fix: steps de dados OK — card depende de GitHub Actions.`);
        }
        linhas.push(`Cards serão gerados no próximo cron agendado.`);

        if (criado) {
          await enviarTelegram(linhas.join("\n"));
        }
      }
    }

    const duracao = Date.now() - inicio;
    const tudoOk = ciclosIncompletos.length === 0;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'mateus-manchete',
        'verificar_pipeline',
        ${tudoOk ? "sucesso" : "aviso"},
        ${JSON.stringify({ ciclos: resultados, ciclos_incompletos: ciclosIncompletos.length })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: tudoOk,
      hora_brt: horaBRT.toFixed(2),
      ciclos_pendentes: ciclosPendentes,
      status: resultados,
      duracao_ms: duracao,
    });
  } catch (err) {
    const duracao = Date.now() - inicio;
    await alertarTelegram("🚨", "MATEUS MANCHETE — ERRO CRÍTICO", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('mateus-manchete', 'verificar_pipeline', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
