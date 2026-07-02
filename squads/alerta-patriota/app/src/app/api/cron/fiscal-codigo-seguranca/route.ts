/**
 * FISCAL CÓDIGO — SEGURANÇA
 * Testa ao vivo se todas as proteções de segurança estão funcionando.
 * Roda a cada 6h. Escala para revisor-seguranca se encontrar problema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

// 5 checks sequenciais com AbortSignal.timeout até 10s cada — pior caso ~50s
export const maxDuration = 60;

interface CheckResult { nome: string; ok: boolean; detalhe: string; severidade: "critico" | "alto" | "medio" }

async function testar(nome: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch (e) {
    return { nome, ok: false, detalhe: `Exceção: ${String(e).substring(0, 100)}`, severidade: "alto" };
  }
}

// FASE 32: a rota dispara testes reais (incluindo um POST e uma execução real e completa
// de /api/cron/fiscal-api) contra endpoints de produção, sem nenhum limite de frequência
// próprio — o docstring diz "roda a cada 6h", mas a Fase 30 já confirmou que o workflow do
// GitHub Actions chama os crons com frequência real muito maior (10-40min). Sem essa trava,
// cada chamada fora do intervalo pretendido soma carga real e desnecessária em produção
// (auth, MP, e uma execução completa do fiscal-api). Cooldown de 5h (abaixo do intervalo de
// 6h documentado) garante que a execução pretendida nunca é pulada, só as repetições extras.
const COOLDOWN_HORAS = 5;

async function jaRodouRecentemente(): Promise<boolean> {
  const rows = await sql`
    SELECT id FROM agentes_log
    WHERE agente = 'fiscal-codigo-seguranca' AND acao = 'auditoria_seguranca'
      AND created_at >= NOW() - INTERVAL '1 hour' * ${COOLDOWN_HORAS}
    LIMIT 1
  `;
  return rows.length > 0;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  if (await jaRodouRecentemente()) {
    return NextResponse.json({ ok: true, pulado_rate_limit: true });
  }

  const inicio = Date.now();
  const checks: CheckResult[] = [];

  // 1. Cron SEM secret deve retornar 401
  checks.push(await testar("cron_sem_secret_bloqueado", async () => {
    const r = await fetch(`${APP}/api/cron/relatorio-ceo`, { signal: AbortSignal.timeout(8000) });
    const ok = r.status === 401;
    return { nome: "cron_sem_secret_bloqueado", ok, detalhe: `status=${r.status} (esperado 401)`, severidade: "critico" };
  }));

  // 2. Admin sem auth deve retornar 401
  checks.push(await testar("admin_sem_auth_bloqueado", async () => {
    const r = await fetch(`${APP}/api/admin/stats`, { signal: AbortSignal.timeout(8000) });
    const ok = r.status === 401;
    return { nome: "admin_sem_auth_bloqueado", ok, detalhe: `status=${r.status} (esperado 401)`, severidade: "critico" };
  }));

  // 3. Setup sem secret deve retornar 401
  checks.push(await testar("setup_sem_auth_bloqueado", async () => {
    const r = await fetch(`${APP}/api/admin/setup`, { method: "POST", signal: AbortSignal.timeout(8000) });
    const ok = r.status === 401;
    return { nome: "setup_sem_auth_bloqueado", ok, detalhe: `status=${r.status} (esperado 401)`, severidade: "critico" };
  }));

  // FASE 27 (item 1): check "cadastro_valida_email" removido — testava /api/auth/cadastro,
  // rota morta excluída (cadastro real de cliente é via /api/assinaturas/criar-direto, sem senha).

  // 4. Webhook MP aceita só POST
  checks.push(await testar("webhook_mp_metodo", async () => {
    const r = await fetch(`${APP}/api/webhook/mercadopago`, { signal: AbortSignal.timeout(8000) });
    const ok = r.status === 405 || r.status === 404;
    return { nome: "webhook_mp_metodo", ok, detalhe: `status=${r.status} (esperado 405)`, severidade: "medio" };
  }));

  // 5. Cron COM secret correto deve funcionar
  checks.push(await testar("cron_com_secret_funciona", async () => {
    if (!CRON) return { nome: "cron_com_secret_funciona", ok: false, detalhe: "CRON_SECRET não configurado!", severidade: "critico" };
    const r = await fetch(`${APP}/api/cron/fiscal-api`, {
      headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(10000),
    });
    const ok = r.status === 200;
    return { nome: "cron_com_secret_funciona", ok, detalhe: `status=${r.status} (esperado 200)`, severidade: "alto" };
  }));

  // FASE 39: check "assinatura_sem_auth" removido — testava /api/assinaturas/criar, rota
  // órfã excluída (nenhum fluxo do produto chamava; cadastro/cobrança real de cliente é via
  // /api/assinaturas/criar-direto e /api/assinaturas/criar-pix, ambas públicas por design).

  const falhas = checks.filter(c => !c.ok);
  const criticos = falhas.filter(c => c.severidade === "critico");

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
    VALUES ('fiscal-codigo-seguranca', 'auditoria_seguranca',
      ${falhas.length === 0 ? "sucesso" : "erro"},
      ${JSON.stringify({ total: checks.length, falhas: falhas.length, criticos: criticos.length, resultados: checks })},
      ${Date.now() - inicio})
  `;

  if (falhas.length > 0) {
    const lista = falhas.map(f => `• [${f.severidade.toUpperCase()}] ${f.nome}: ${f.detalhe}`).join("\n");

    // Registra alerta e escala para o revisor
    const { criado } = await criarAlertaDedup(
      "codigo_seguranca",
      criticos.length > 0 ? "critico" : "alto",
      `Falhas de segurança detectadas: ${falhas.map(f => f.nome).join(", ")}`
    );

    if (criado) {
      await alertarTelegram(
        criticos.length > 0 ? "🚨" : "🔴",
        `FISCAL CÓDIGO — FALHA DE SEGURANÇA (${falhas.length}/${checks.length})`,
        `${lista}\n\n⚠️ Escalando para Revisor de Segurança...`
      );
    }

    await fetch(`${APP}/api/cron/revisor-seguranca`, {
      headers: { Authorization: `Bearer ${CRON}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: falhas.length === 0, total: checks.length, falhas: falhas.length, checks });
}
