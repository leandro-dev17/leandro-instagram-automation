/**
 * FISCAL CÓDIGO — SEGURANÇA
 * Testa ao vivo se todas as proteções de segurança estão funcionando.
 * Roda a cada 6h. Escala para revisor-seguranca se encontrar problema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

interface CheckResult { nome: string; ok: boolean; detalhe: string; severidade: "critico" | "alto" | "medio" }

async function testar(nome: string, fn: () => Promise<CheckResult>): Promise<CheckResult> {
  try {
    return await fn();
  } catch (e) {
    return { nome, ok: false, detalhe: `Exceção: ${String(e).substring(0, 100)}`, severidade: "alto" };
  }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

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

  // 4. Cadastro com email inválido deve rejeitar
  checks.push(await testar("cadastro_valida_email", async () => {
    const r = await fetch(`${APP}/api/auth/cadastro`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome: "Teste", email: "nao-e-email", senha: "123456" }),
      signal: AbortSignal.timeout(8000),
    });
    const ok = r.status === 400;
    return { nome: "cadastro_valida_email", ok, detalhe: `status=${r.status} (esperado 400)`, severidade: "alto" };
  }));

  // 5. Webhook MP aceita só POST
  checks.push(await testar("webhook_mp_metodo", async () => {
    const r = await fetch(`${APP}/api/webhook/mercadopago`, { signal: AbortSignal.timeout(8000) });
    const ok = r.status === 405 || r.status === 404;
    return { nome: "webhook_mp_metodo", ok, detalhe: `status=${r.status} (esperado 405)`, severidade: "medio" };
  }));

  // 6. Cron COM secret correto deve funcionar
  checks.push(await testar("cron_com_secret_funciona", async () => {
    if (!CRON) return { nome: "cron_com_secret_funciona", ok: false, detalhe: "CRON_SECRET não configurado!", severidade: "critico" };
    const r = await fetch(`${APP}/api/cron/fiscal-api`, {
      headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(10000),
    });
    const ok = r.status === 200;
    return { nome: "cron_com_secret_funciona", ok, detalhe: `status=${r.status} (esperado 200)`, severidade: "alto" };
  }));

  // 7. Assinatura sem auth deve rejeitar
  checks.push(await testar("assinatura_sem_auth", async () => {
    const r = await fetch(`${APP}/api/assinaturas/criar`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plano: "basico" }), signal: AbortSignal.timeout(8000),
    });
    const ok = r.status === 401;
    return { nome: "assinatura_sem_auth", ok, detalhe: `status=${r.status} (esperado 401)`, severidade: "critico" };
  }));

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
    await alertarTelegram(
      criticos.length > 0 ? "🚨" : "🔴",
      `FISCAL CÓDIGO — FALHA DE SEGURANÇA (${falhas.length}/${checks.length})`,
      `${lista}\n\n⚠️ Escalando para Revisor de Segurança...`
    );

    // Registra alerta e escala para o revisor
    await sql`
      INSERT INTO alertas (tipo, severidade, mensagem)
      VALUES ('codigo_seguranca', ${criticos.length > 0 ? "critico" : "alto"},
        ${`Falhas de segurança detectadas: ${falhas.map(f => f.nome).join(", ")}`})
    `;

    await fetch(`${APP}/api/cron/revisor-seguranca`, {
      headers: { Authorization: `Bearer ${CRON}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});
  }

  return NextResponse.json({ ok: falhas.length === 0, total: checks.length, falhas: falhas.length, checks });
}
