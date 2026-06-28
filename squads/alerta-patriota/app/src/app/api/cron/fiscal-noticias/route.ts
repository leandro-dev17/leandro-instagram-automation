import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram, alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

// Item 16 (Fase 30): sem maxDuration, a Vercel mata a função em 10s por padrão — chamarAutoFix()
// soma até 105s no pior caso (3 etapas × até 30s de fetch + 5s de pausa entre cada). 60s é o teto
// do plano Hobby (mesmo padrão já aplicado em fiscal-pipeline.ts/fiscal-workflow.ts na Fase 32).
export const maxDuration = 60;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
const CRON_SECRET = process.env.CRON_SECRET || "";

type Estoque = {
  vip: number;
  elite: number;
};

async function contarEstoque(): Promise<Estoque> {
  const [vip, elite] = await Promise.all([
    sql`
      SELECT COUNT(*) as total FROM noticias
      WHERE resumo_braga IS NOT NULL
        AND postada_vip = false
    `,
    sql`
      SELECT COUNT(*) as total FROM noticias
      WHERE resumo_cavalcanti IS NOT NULL
        AND postada_elite = false
    `,
  ]);

  return {
    vip: Number(vip[0].total),
    elite: Number(elite[0].total),
  };
}

async function chamarAutoFix(): Promise<Record<string, string>> {
  const resultado: Record<string, string> = {};
  const headers = {
    Authorization: `Bearer ${CRON_SECRET}`,
    "Content-Type": "application/json",
  };

  const etapas: Array<{ nome: string; rota: string }> = [
    { nome: "coletar", rota: `${APP_URL}/api/cron/coletar-noticias` },
    { nome: "curar", rota: `${APP_URL}/api/cron/curar-noticias` },
    { nome: "resumir", rota: `${APP_URL}/api/cron/resumir-noticias` },
  ];

  for (const etapa of etapas) {
    try {
      const res = await fetch(etapa.rota, { method: "GET", headers, signal: AbortSignal.timeout(30000) });
      resultado[etapa.nome] = res.ok ? "chamado" : `erro_${res.status}`;
    } catch (e) {
      resultado[etapa.nome] = `falhou: ${String(e).slice(0, 80)}`;
    }
    await new Promise((r) => setTimeout(r, 5000));
  }

  return resultado;
}

function nivelEstoque(qtd: number): string {
  if (qtd === 0) return "← CRÍTICO";
  if (qtd < 3) return "← BAIXO";
  return "← OK";
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    const estoque = await contarEstoque();
    const gruposCriticos = Object.entries(estoque).filter(([, qtd]) => qtd < 2);
    const autoFixResult: Record<string, string> = {};

    if (gruposCriticos.length > 0) {
      const fixResult = await chamarAutoFix();
      Object.assign(autoFixResult, fixResult);

      const estoqueAposfix = await contarEstoque();
      const gruposAindaCriticos = Object.entries(estoqueAposfix).filter(([, qtd]) => qtd < 1);

      if (gruposAindaCriticos.length > 0) {
        const mensagem = `Estoque crítico mesmo após auto-fix. Grupos sem notícias: ${gruposAindaCriticos.map(([g]) => g).join(", ")}`;
        await criarAlertaDedup("estoque_critico", "critico", mensagem);
      }

      // FASE 23: este aviso disparava Telegram a cada execução enquanto o estoque
      // permanecesse baixo — só o caso "ainda crítico após auto-fix" tinha dedup
      // (criarAlertaDedup acima), faltava aplicar o mesmo aqui.
      const { criado: avisoCriado } = await criarAlertaDedup(
        "estoque_baixo",
        "medio",
        `Estoque baixo — VIP: ${estoque.vip}, Elite: ${estoque.elite}`
      );

      if (avisoCriado) {
        const linhas = [
          `⚠️ SOFIA STOQUE — Estoque Crítico`,
          `Notícias prontas:`,
          `• VIP: ${estoque.vip} ${nivelEstoque(estoque.vip)}`,
          `• Elite: ${estoque.elite} ${nivelEstoque(estoque.elite)}`,
          ``,
          `Auto-fix: coletar + curar + resumir acionados.`,
          `Resultado: ${JSON.stringify(fixResult)}`,
        ];

        await enviarTelegram(linhas.join("\n"));
      }
    }

    const duracao = Date.now() - inicio;
    const tudoOk = gruposCriticos.length === 0;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'sofia-stoque',
        'verificar_estoque',
        ${tudoOk ? "sucesso" : "aviso"},
        ${JSON.stringify({ estoque, grupos_criticos: gruposCriticos.map(([g]) => g), auto_fix: autoFixResult })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: tudoOk,
      estoque,
      grupos_criticos: gruposCriticos.map(([g]) => g),
      auto_fix: autoFixResult,
      duracao_ms: duracao,
    });
  } catch (err) {
    const duracao = Date.now() - inicio;
    await alertarTelegram("🚨", "SOFIA STOQUE — ERRO CRÍTICO", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('sofia-stoque', 'verificar_estoque', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
