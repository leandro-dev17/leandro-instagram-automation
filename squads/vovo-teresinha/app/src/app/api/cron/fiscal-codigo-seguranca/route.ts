/**
 * FISCAL RODRIGO REGRAS — Fiscal de Segurança de Código
 * Testa autenticação e autorização de todas as rotas críticas do app.
 * Se detectar falha → grava em falhas_agentes e aciona revisor-seguranca.
 */
import { NextRequest, NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/auth-cron";
import { alertarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

async function testarRota(rota: string, opcoes?: RequestInit): Promise<{ status: number }> {
  try {
    const res = await fetch(`${APP}${rota}`, { ...opcoes, signal: AbortSignal.timeout(8000) });
    return { status: res.status };
  } catch {
    return { status: 0 };
  }
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const falhas: string[] = [];
  const checks: Record<string, { ok: boolean; motivo?: string }> = {};

  // 1. Cron sem secret → deve bloquear (401)
  const cronSemAuth = await testarRota("/api/cron/fiscal-diario");
  checks.cron_sem_secret_bloqueado = cronSemAuth.status === 401
    ? { ok: true }
    : { ok: false, motivo: `fiscal-diario sem auth retornou ${cronSemAuth.status} (esperado 401)` };

  // 2. Rota admin sem auth → deve bloquear (401 ou 403)
  const adminSemAuth = await testarRota("/api/admin/usuarios");
  checks.admin_sem_auth_bloqueado = [401, 403].includes(adminSemAuth.status)
    ? { ok: true }
    : { ok: false, motivo: `admin/usuarios sem auth retornou ${adminSemAuth.status} (esperado 401/403)` };

  // 3. Favoritos sem auth → deve bloquear (401)
  const favoritosSemAuth = await testarRota("/api/usuarios/favoritos");
  checks.favoritos_sem_auth_bloqueado = favoritosSemAuth.status === 401
    ? { ok: true }
    : { ok: false, motivo: `favoritos sem auth retornou ${favoritosSemAuth.status} (esperado 401)` };

  // 4. Plano semanal sem auth → deve bloquear (401)
  const planoSemAuth = await testarRota("/api/plano-semanal");
  checks.plano_semanal_sem_auth_bloqueado = planoSemAuth.status === 401
    ? { ok: true }
    : { ok: false, motivo: `plano-semanal sem auth retornou ${planoSemAuth.status} (esperado 401)` };

  // 5. Lista de compras sem auth → deve bloquear (401)
  const listaSemAuth = await testarRota("/api/lista-compras");
  checks.lista_compras_sem_auth_bloqueado = listaSemAuth.status === 401
    ? { ok: true }
    : { ok: false, motivo: `lista-compras sem auth retornou ${listaSemAuth.status} (esperado 401)` };

  // 6. Geladeira sem auth → deve bloquear (401)
  const geladeirasSemAuth = await testarRota("/api/geladeira");
  checks.geladeira_sem_auth_bloqueado = geladeirasSemAuth.status === 401
    ? { ok: true }
    : { ok: false, motivo: `geladeira sem auth retornou ${geladeirasSemAuth.status} (esperado 401)` };

  // 7. Webhook MP sem payload → deve rejeitar (400/401/403)
  const webhookSemSig = await testarRota("/api/webhooks/mercadopago", { method: "POST" });
  checks.webhook_mp_valida_assinatura = [400, 401, 403, 405].includes(webhookSemSig.status)
    ? { ok: true }
    : { ok: false, motivo: `webhook MP sem payload retornou ${webhookSemSig.status} (esperado 400/401/403)` };

  // 8. Cron com secret válido → deve funcionar (200)
  if (CRON) {
    const cronComAuth = await testarRota("/api/cron/fiscal-diario", {
      headers: { Authorization: `Bearer ${CRON}` },
    });
    checks.cron_com_secret_funciona = cronComAuth.status === 200
      ? { ok: true }
      : { ok: false, motivo: `fiscal-diario com auth retornou ${cronComAuth.status} (esperado 200)` };
  } else {
    checks.cron_com_secret_funciona = { ok: false, motivo: "CRON_SECRET não configurado no ambiente" };
  }

  // Coleta falhas
  for (const [check, result] of Object.entries(checks)) {
    if (!result.ok && result.motivo) {
      falhas.push(`[${check}] ${result.motivo}`);
    }
  }

  if (falhas.length > 0) {
    for (const falha of falhas) {
      await reportarFalha("fiscal-codigo-seguranca", falha, {
        severidade: "alto",
        tipo: "codigo_seguranca",
      });
    }

    // Aciona revisor imediatamente
    fetch(`${APP}/api/cron/revisor-seguranca`, {
      headers: { Authorization: `Bearer ${CRON}` },
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    await alertarTelegram(
      "🔐",
      "FISCAL SEGURANÇA — FALHAS DETECTADAS",
      falhas.map(f => `❌ ${f}`).join("\n") + "\n\n🔧 Revisor de segurança acionado."
    );
  } else {
    await resolverFalhas("fiscal-codigo-seguranca");
  }

  return NextResponse.json({ ok: falhas.length === 0, checks, falhas });
}
