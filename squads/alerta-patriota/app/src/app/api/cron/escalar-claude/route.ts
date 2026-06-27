/**
 * ESCALONAMENTO PARA CLAUDE — Alertas críticos sem resolução há 2h
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";

// Sem maxDuration, a Vercel mata a função em 10s por padrão — e a query de alertas abertos
// não tinha LIMIT, então um acúmulo de alertas críticos (justamente o cenário em que este
// agente é mais necessário) faria o loop de auto-fix (até 30s por alerta em cards_sem_envio,
// que dispara 2 fetches sequenciais de 15s) crescer sem teto.
export const maxDuration = 60;
const ORCAMENTO_MS = 45000;

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

const MAPA_ARQUIVOS: Record<string, string> = {
  cards_sem_envio: "squads/alerta-patriota/app/src/app/api/cron/gerar-card/route.ts",
  cards_com_erro: "squads/alerta-patriota/app/src/app/api/cron/gerar-card/route.ts",
  cards_sem_imagem: "squads/alerta-patriota/app/src/app/api/cron/gerar-card/route.ts",
  conteudo_irrelevante: "api/cron/curar-noticias/route.ts",
  workflow_falhando: "api/cron/fiscal-workflow/route.ts",
  workflow_erro_api: "api/cron/fiscal-workflow/route.ts",
  duplicata_detectada: "api/cron/publicar-noticias/route.ts",
  fiscal_whatsapp: "src/lib/whatsapp.ts",
  fiscal_banco: "src/lib/db.ts",
};

async function tentarAutoFix(tipo: string): Promise<string> {
  const headers = { Authorization: `Bearer ${CRON_SECRET}` };

  try {
    if (tipo === "cards_sem_envio" || tipo === "cards_sem_imagem") {
      await fetch(`${APP_URL}/api/cron/coletar-noticias`, { headers, signal: AbortSignal.timeout(15000) });
      await fetch(`${APP_URL}/api/cron/resumir-noticias`, { headers, signal: AbortSignal.timeout(15000) });
      return "✅ coletar-noticias + resumir-noticias acionados";
    }

    if (tipo === "conteudo_irrelevante") {
      await fetch(`${APP_URL}/api/cron/curar-noticias?forcar_filtro=true`, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
      return "✅ curar-noticias acionado com filtro forçado";
    }

    if (tipo === "workflow_falhando" || tipo === "workflow_erro_api") {
      return "⚠️ Workflows GitHub Actions não podem ser reiniciados automaticamente — intervenção manual necessária";
    }
  } catch (err) {
    return `❌ Erro no auto-fix: ${String(err)}`;
  }

  return "ℹ️ Sem auto-fix disponível para este tipo";
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    const alertasAbertos = await sql`
      SELECT id, tipo, severidade, mensagem, created_at
      FROM alertas
      WHERE resolvido = false
        AND severidade IN ('critico', 'alto')
        AND created_at < NOW() - INTERVAL '2 hours'
      ORDER BY severidade DESC, created_at ASC
      LIMIT 15
    `;

    if (alertasAbertos.length === 0) {
      const duracao = Date.now() - inicio;
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
        VALUES ('escalar-claude', 'verificar_alertas', 'sucesso', '{"alertas_abertos": 0}', ${duracao})
      `;
      return NextResponse.json({ ok: true, alertas_escalados: 0, duracao_ms: duracao });
    }

    const escalados: Array<Record<string, unknown>> = [];
    const linhasMsg: string[] = [];

    linhasMsg.push(`<b>🆘 ESCALONAMENTO PARA CLAUDE</b>`);
    linhasMsg.push(`${alertasAbertos.length} alerta(s) crítico(s) sem resolução:\n`);

    let pulados = 0;
    for (const alerta of alertasAbertos) {
      // Alertas pulados por orçamento continuam com resolvido=false e serão reavaliados
      // (e reescalados) na próxima execução — nenhum alerta é perdido, só atrasado.
      if (Date.now() - inicio > ORCAMENTO_MS) {
        pulados = alertasAbertos.length - escalados.length;
        break;
      }

      const tipo = String(alerta.tipo);
      const severidade = String(alerta.severidade);
      const mensagem = String(alerta.mensagem);
      const criadoEm = new Date(String(alerta.created_at));
      const horasSemResolucao = Math.round((Date.now() - criadoEm.getTime()) / 1000 / 3600);
      const arquivo = MAPA_ARQUIVOS[tipo] || "desconhecido";

      const autoFixResult = await tentarAutoFix(tipo);

      const icone = severidade === "critico" ? "🔴" : "🟠";

      linhasMsg.push(
        `${icone} <b>${tipo}</b> — ${horasSemResolucao}h sem resolução\n"${mensagem}"\nArquivo provável: <code>${arquivo}</code>\nAuto-fix: ${autoFixResult}\n`
      );

      escalados.push({
        id: alerta.id,
        tipo,
        severidade,
        mensagem,
        horas_aberto: horasSemResolucao,
        arquivo_provavel: arquivo,
        auto_fix: autoFixResult,
      });
    }

    if (pulados > 0) {
      linhasMsg.push(`⏱️ ${pulados} alerta(s) adicional(is) pulado(s) por orçamento de tempo — serão reescalados na próxima execução.`);
    }
    linhasMsg.push(`Para acionar o Claude, execute no Claude Code:\n<code>/BioNexus Digital run alerta-patriota</code>`);
    linhasMsg.push(`\n📋 Ver painel: ${APP_URL}/admin`);

    await enviarTelegram(linhasMsg.join("\n"));

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'escalar-claude',
        'escalar_alertas_criticos',
        'aviso',
        ${JSON.stringify({ alertas_escalados: alertasAbertos.length, tipos: alertasAbertos.map((a) => a.tipo) })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: false,
      alertas_escalados: alertasAbertos.length,
      escalados,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "ESCALONAMENTO CLAUDE — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
