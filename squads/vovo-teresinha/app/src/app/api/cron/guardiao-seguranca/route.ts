/**
 * GUARDIÃO GUSTAVO — Guardião de Segurança 24/7
 * Monitora segurança básica e despacha o Squad de Revisão de Código a cada execução.
 * Executa diariamente. Usa app_configuracoes para rastrear última execução de cada fiscal.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram, alertarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

// Squad de Revisão de Código — disparado a cada execução do Guardião
const SQUAD_REVISAO = [
  { agente: "fiscal-codigo-seguranca",   rota: "/api/cron/fiscal-codigo-seguranca"   },
  { agente: "fiscal-codigo-schema",      rota: "/api/cron/fiscal-codigo-schema"      },
  { agente: "fiscal-codigo-logica",      rota: "/api/cron/fiscal-codigo-logica"      },
  { agente: "fiscal-codigo-performance", rota: "/api/cron/fiscal-codigo-performance" },
];

async function dispararAgente(rota: string): Promise<boolean> {
  try {
    const res = await fetch(`${APP}${rota}`, {
      headers: { Authorization: `Bearer ${CRON}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const alertas: string[] = [];
  const dispatched: string[] = [];

  try {
    // ── 1. SEGURANÇA BÁSICA ──────────────────────────────────────────────────

    // Verifica brute force (coluna pode não existir)
    const colExists = await sql`
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'usuarios' AND column_name = 'login_tentativas'
    `;
    if (colExists.length > 0) {
      const suspeitos = await sql`
        SELECT id, email, login_tentativas FROM usuarios WHERE login_tentativas > 10
      `;
      if (suspeitos.length > 0) {
        const lista = suspeitos
          .map((u: { email: string; login_tentativas: number }) => `${u.email} (${u.login_tentativas} tentativas)`)
          .join("\n");
        alertas.push(`🔐 Logins suspeitos (>10 falhas):\n${lista}`);
      }
    }

    // Push subscriptions duplicadas (>3 por usuário)
    const duplicadas = await sql`
      SELECT usuario_id, COUNT(*)::int AS total
      FROM push_subscriptions
      GROUP BY usuario_id
      HAVING COUNT(*) > 3
    `;
    if (duplicadas.length > 0) {
      alertas.push(`📱 ${duplicadas.length} usuário(s) com push subscriptions duplicadas (>3)`);
    }

    // Admins criados recentemente (alerta de segurança)
    const novosAdmins = await sql`
      SELECT id, email, nome FROM usuarios
      WHERE tipo_usuario = 'admin'
        AND criado_em > NOW() - INTERVAL '48 hours'
    `;
    if (novosAdmins.length > 0) {
      const lista = novosAdmins
        .map((a: { email: string; nome: string }) => `${a.nome} <${a.email}>`)
        .join("\n");
      alertas.push(`🚨 Admin criado nas últimas 48h:\n${lista}`);
    }

    // Falhas críticas acumuladas (>20 falhas abertas total)
    const [backlog] = await sql`
      SELECT COUNT(*)::int AS total FROM falhas_agentes WHERE resolvido = false
    `;
    if (Number(backlog.total) > 20) {
      alertas.push(`⚠️ Backlog de falhas elevado: ${backlog.total} falhas abertas`);
    }

    // ── 2. SQUAD REVISÃO DE CÓDIGO ───────────────────────────────────────────

    for (const agente of SQUAD_REVISAO) {
      const ok = await dispararAgente(agente.rota);
      if (ok) {
        dispatched.push(agente.agente);
      } else {
        alertas.push(`❌ Falhou ao disparar ${agente.agente}`);
      }
      // Pequeno delay para não sobrecarregar
      await new Promise(r => setTimeout(r, 500));
    }

    // ── 3. RELATÓRIO ─────────────────────────────────────────────────────────

    if (alertas.length > 0) {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      await enviarTelegram(
        `🛡️ <b>Guardião de Segurança — ${hora}</b>\n\n` +
        alertas.join("\n\n") +
        `\n\n<i>Verifique imediatamente se necessário.</i>`
      );
    }

    if (dispatched.length > 0) {
      await enviarTelegram(
        `🔍 <b>Guardião — Squad Revisão de Código Disparado</b>\n\n` +
        dispatched.map(a => `  ✅ ${a}`).join("\n") +
        `\n\n<i>Fiscais de código executando em background.</i>`
      );
    }

    await resolverFalhas("guardiao-seguranca");
    return NextResponse.json({ ok: true, alertas, dispatched });
  } catch (err) {
    await reportarFalha("guardiao-seguranca", String(err));
    await alertarTelegram("🚨", "GUARDIÃO — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
