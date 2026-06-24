import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// FASE 24: a validação anterior só checava o prefixo "/api/cron/" — qualquer admin
// autenticado podia disparar QUALQUER rota cron existente via POST direto (não só as
// ~14 da UI), inclusive claude-revisor (que tem permissão de commit direto na main e
// redeploy no Vercel, ver lib/auth.ts) e as ~25 rotas fiscal-*. Allowlist explícita
// fecha esse gap mantendo todas as rotas legítimas existentes funcionando.
const ROTAS_CRON_PERMITIDAS = new Set([
  "/api/cron/guardiao-seguranca", "/api/cron/gerente-financeiro", "/api/cron/cacador-desistentes",
  "/api/cron/gerente-clientes", "/api/cron/gerente-conteudo", "/api/cron/gerente-tecnico",
  "/api/cron/escalar-claude", "/api/cron/fix-encoding", "/api/cron/agente-heartbeat",
  "/api/cron/revisor-seguranca", "/api/cron/facebook-postar", "/api/cron/facebook-comentarios",
  "/api/cron/curar-noticias", "/api/cron/revisor-schema", "/api/cron/revisor-logica",
  "/api/cron/modo-crise", "/api/cron/publicar-noticias", "/api/cron/analise-semanal-vip",
  "/api/cron/semana-em-revista", "/api/cron/dossie-elite", "/api/cron/bom-dia",
  "/api/cron/resumo-noite", "/api/cron/moderacao-grupo", "/api/cron/fiscal-mrr",
  "/api/cron/fiscal-facebook", "/api/cron/fiscal-codigo-logica", "/api/cron/gerar-card",
  "/api/cron/bot-responder", "/api/cron/resumir-noticias", "/api/cron/resumir-noticias-global",
  "/api/cron/backup", "/api/cron/fiscal-duplicatas", "/api/cron/fiscal-cards",
  "/api/cron/fiscal-grupos", "/api/cron/fiscal-apis-externas", "/api/cron/fiscal-whatsapp",
  "/api/cron/fiscal-fontes", "/api/cron/fiscal-agendamento", "/api/cron/fiscal-workflow",
  "/api/cron/fiscal-conteudo", "/api/cron/fiscal-codigo-seguranca", "/api/cron/fiscal-codigo-schema",
  "/api/cron/fiscal-pipeline", "/api/cron/fiscal-qualidade-resumo", "/api/cron/fiscal-especiais",
  "/api/cron/fiscal-login", "/api/cron/fiscal-api", "/api/cron/sequencia-nao-conversao",
  "/api/cron/relatorio-ceo", "/api/cron/gerente-codigo", "/api/cron/claude-revisor",
  "/api/cron/fiscal-codigo-performance", "/api/cron/fiscal-pagamentos", "/api/cron/fiscal-trials",
  "/api/cron/enquete-dia", "/api/cron/personagem-semana", "/api/cron/radar-economico",
  "/api/cron/termometro", "/api/cron/agente-limpeza", "/api/cron/engajamento",
  "/api/cron/preditor-churn", "/api/cron/upgrade-comportamental", "/api/cron/fiscal-inadimplentes",
  "/api/cron/fiscal-noticias", "/api/cron/fiscal-banco", "/api/cron/agente-medico",
  "/api/cron/coletar-noticias", "/api/cron/coletar-noticias-global", "/api/cron/radar-politico",
  "/api/cron/campanha-recuperacao",
]);

// GET — status e últimas execuções de todos os agentes
export async function GET() {
  try {
    await requireAdmin();

    const logs = await sql`
      SELECT agente,
        MAX(created_at) as ultima_execucao,
        COUNT(*) FILTER (WHERE status = 'sucesso' AND created_at >= NOW() - INTERVAL '24 hours') as sucesso_24h,
        COUNT(*) FILTER (WHERE status = 'erro' AND created_at >= NOW() - INTERVAL '24 hours') as erro_24h,
        (SELECT status FROM agentes_log a2 WHERE a2.agente = a.agente ORDER BY created_at DESC LIMIT 1) as ultimo_status
      FROM agentes_log a
      WHERE created_at >= NOW() - INTERVAL '7 days'
      GROUP BY agente
      ORDER BY ultima_execucao DESC
    `;

    const alertasAbertos = await sql`
      SELECT * FROM alertas WHERE resolvido = false ORDER BY created_at DESC LIMIT 20
    `;

    return NextResponse.json({ agentes: logs, alertas: alertasAbertos });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

// POST — executa agente manualmente
export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { rota } = await req.json();
    if (!rota || !ROTAS_CRON_PERMITIDAS.has(rota)) return NextResponse.json({ erro: "Rota inválida" }, { status: 400 });

    const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "";
    const CRON_SECRET = process.env.CRON_SECRET || "";

    const res = await fetch(`${APP_URL}${rota}`, {
      headers: { Authorization: `Bearer ${CRON_SECRET}` },
      signal: AbortSignal.timeout(30000),
    });

    const data = await res.json();
    return NextResponse.json({ ok: res.ok, status: res.status, resultado: data });
  } catch (err) {
    console.error("admin/agentes POST error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
