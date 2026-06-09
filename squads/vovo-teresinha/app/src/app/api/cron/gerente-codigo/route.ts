/**
 * GERENTE GABRIEL GESTOR — Gerente de Código (Nível 4)
 * Consolida relatórios dos 3 revisores e decide se aciona o claude-revisor.
 * Dedup: não envia relatório em <30min desde o último.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

export async function POST(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const inicio = Date.now();

  try {
    // Dedup: não reportar se já rodou nos últimos 30min
    const [ultimoRelatorio] = await sql`
      SELECT criado_em FROM falhas_agentes
      WHERE agente = 'gerente-codigo' AND resolvido = true
      ORDER BY criado_em DESC LIMIT 1
    `;
    if (ultimoRelatorio) {
      const diffMin = (Date.now() - new Date(ultimoRelatorio.criado_em as string).getTime()) / 60000;
      if (diffMin < 30) {
        return NextResponse.json({ ok: true, motivo: `Relatório recente (${diffMin.toFixed(0)}min atrás)` });
      }
    }

    const body = await req.json().catch(() => ({})) as {
      origem?: string;
      corrigidos?: string[];
      naoCorrigidos?: string[];
      acoes?: string[];
      alertas?: Array<{ tipo: string; mensagem: string }>;
      analise?: string;
    };

    // Busca todos os alertas abertos dos 4 fiscais de código (últimas 6h)
    const alertasAbertos = await sql`
      SELECT agente, COUNT(*)::int AS total, MAX(erro) AS ultimo_erro
      FROM falhas_agentes
      WHERE agente IN (
        'fiscal-codigo-seguranca',
        'fiscal-codigo-schema',
        'fiscal-codigo-logica',
        'fiscal-codigo-performance',
        'fiscal-codigo-estatico'
      )
        AND resolvido = false
        AND criado_em > NOW() - INTERVAL '6 hours'
      GROUP BY agente
      ORDER BY total DESC
    ` as { agente: string; total: number; ultimo_erro: string }[];

    const totalAlertas = alertasAbertos.reduce((sum, r) => sum + r.total, 0);

    // Se há alertas → aciona claude-revisor com lista de problemas
    if (totalAlertas > 0) {
      const alertasParaClaude = body.alertas ?? alertasAbertos.map(r => ({
        tipo: r.agente.replace("fiscal-codigo-", "codigo_"),
        mensagem: r.ultimo_erro,
      }));

      fetch(`${APP}/api/cron/claude-revisor`, {
        method: "POST",
        headers: { Authorization: `Bearer ${CRON}`, "Content-Type": "application/json" },
        body: JSON.stringify({ alertas: alertasParaClaude }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    // Registra que gerente rodou (para dedup)
    await sql`
      INSERT INTO falhas_agentes (agente, erro, dados, tentativas, resolvido, resolvido_em)
      VALUES ('gerente-codigo', 'relatorio_consolidado',
        ${JSON.stringify({ totalAlertas, origem: body.origem ?? "direto" })},
        1, true, NOW())
    `;

    // Monta relatório consolidado
    const linhas: string[] = [`📊 <b>Gerente de Código — Vovó Teresinha Bot</b>`];

    if (alertasAbertos.length > 0) {
      linhas.push(`\n🚨 <b>Alertas Abertos:</b>`);
      for (const r of alertasAbertos) {
        linhas.push(`  ❌ ${r.agente}: ${r.total} falha(s)`);
        linhas.push(`     ↳ ${r.ultimo_erro.slice(0, 80)}`);
      }
    }

    if (body.corrigidos?.length) {
      linhas.push(`\n✅ <b>Schema auto-corrigido:</b>`);
      body.corrigidos.forEach(c => linhas.push(`  • ${c}`));
    }

    if (body.naoCorrigidos?.length) {
      linhas.push(`\n⚠️ <b>Schema sem autocorrect:</b>`);
      body.naoCorrigidos.forEach(c => linhas.push(`  • ${c}`));
    }

    if (body.acoes?.length) {
      linhas.push(`\n🔧 <b>Lógica corrigida:</b>`);
      body.acoes.forEach(a => linhas.push(`  • ${a}`));
    }

    if (body.analise) {
      linhas.push(`\n🔐 <b>Análise Segurança:</b>\n${body.analise}`);
    }

    if (totalAlertas > 0) {
      linhas.push(`\n🤖 Claude Revisor acionado (${totalAlertas} alerta(s))`);
    } else {
      linhas.push(`\n✅ Nenhum alerta crítico pendente — sistema saudável!`);
    }

    linhas.push(`\n⏱️ ${Date.now() - inicio}ms`);

    await enviarTelegram(linhas.join("\n"));

    return NextResponse.json({ ok: true, totalAlertas, origem: body.origem, duracao_ms: Date.now() - inicio });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
