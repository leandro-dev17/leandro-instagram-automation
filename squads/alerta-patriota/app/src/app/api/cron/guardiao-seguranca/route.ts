/**
 * AGENTE GUSTAVO GUARDA — Guardião 24/7
 * Roda a cada 30 minutos. Responsabilidades:
 * 1. Segurança: monitora brute force e alertas críticos
 * 2. SQUAD REVISÃO DE CÓDIGO: garante que todos os agentes estejam ativos
 *    — Fiscais (a cada 6h): segurança, schema, lógica, performance
 *    — Gerente de Código (a cada 2h)
 *    — Dispara automaticamente qualquer agente que não rodou no prazo
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

// Agentes do Squad de Revisão de Código com seus intervalos máximos
const SQUAD_REVISAO = [
  { agente: "fiscal-codigo-seguranca",  rota: "/api/cron/fiscal-codigo-seguranca",  maxHoras: 6.5  },
  { agente: "fiscal-codigo-schema",     rota: "/api/cron/fiscal-codigo-schema",     maxHoras: 6.5  },
  { agente: "fiscal-codigo-logica",     rota: "/api/cron/fiscal-codigo-logica",     maxHoras: 6.5  },
  { agente: "fiscal-codigo-performance",rota: "/api/cron/fiscal-codigo-performance",maxHoras: 6.5  },
  { agente: "gerente-codigo",           rota: "/api/cron/gerente-codigo",           maxHoras: 2.5  },
];

async function dispararAgente(rota: string, metodo: string = "GET"): Promise<boolean> {
  try {
    const res = await fetch(`${APP}${rota}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${CRON}` },
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const alertas: string[] = [];
  const disparados: string[] = [];
  const squadStatus: Record<string, string> = {};

  try {
    // ── 1. SEGURANÇA BÁSICA ──────────────────────────────────────────────────
    const tentativasSuspeitas = await sql`
      SELECT agente, COUNT(*) as tentativas
      FROM agentes_log
      WHERE agente LIKE '%login%' AND status = 'erro'
      AND created_at >= NOW() - INTERVAL '30 minutes'
      GROUP BY agente
      HAVING COUNT(*) >= 5
    `;
    if (tentativasSuspeitas.length > 0) {
      alertas.push(`⚠️ ${tentativasSuspeitas.length} padrão(s) de brute force detectados`);
    }

    const alertasCriticos = await sql`
      SELECT COUNT(*) as total FROM alertas
      WHERE severidade = 'critico' AND resolvido = false
      AND created_at <= NOW() - INTERVAL '1 hour'
    `;
    if (Number(alertasCriticos[0].total) > 0) {
      alertas.push(`🚨 ${alertasCriticos[0].total} alerta(s) crítico(s) sem resolução há +1h`);
    }

    // ── 2. SQUAD REVISÃO DE CÓDIGO — verifica e dispara atrasados ──────────
    for (const agente of SQUAD_REVISAO) {
      const ultimaExec = await sql`
        SELECT created_at, status FROM agentes_log
        WHERE agente = ${agente.agente}
        ORDER BY created_at DESC LIMIT 1
      `;

      if (ultimaExec.length === 0) {
        // Nunca rodou — dispara agora
        const ok = await dispararAgente(agente.rota);
        squadStatus[agente.agente] = ok ? "🔄 disparado (primeira vez)" : "❌ falhou ao disparar";
        disparados.push(agente.agente);
        continue;
      }

      const ultima = new Date(ultimaExec[0].created_at as string);
      const diffHoras = (Date.now() - ultima.getTime()) / 3_600_000;

      if (diffHoras > agente.maxHoras) {
        // Atrasado — dispara
        const ok = await dispararAgente(agente.rota);
        squadStatus[agente.agente] = ok
          ? `🔄 disparado (atrasado ${diffHoras.toFixed(1)}h)`
          : `❌ falhou ao disparar (atrasado ${diffHoras.toFixed(1)}h)`;
        if (ok) disparados.push(agente.agente);
        else alertas.push(`❌ ${agente.agente} atrasado ${diffHoras.toFixed(1)}h — disparo falhou`);
      } else {
        const statusIcon = ultimaExec[0].status === "sucesso" ? "✅" : "⚠️";
        squadStatus[agente.agente] = `${statusIcon} OK (${diffHoras.toFixed(1)}h atrás)`;
      }
    }

    // ── 3. RELATÓRIO ────────────────────────────────────────────────────────
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('gustavo-guarda', 'varredura_completa',
        ${alertas.length === 0 ? "sucesso" : "aviso"},
        ${JSON.stringify({ alertas, disparados, squadStatus })})
    `;

    // Notifica no Telegram
    if (alertas.length > 0) {
      await alertarTelegram("🔐", "GUARDIÃO — ALERTAS ATIVOS", alertas.join("\n"));
    }

    if (disparados.length > 0) {
      await enviarTelegram(
        `🛡️ *GUARDIÃO — SQUAD REVISÃO DE CÓDIGO*\n` +
        `Agentes disparados automaticamente:\n` +
        disparados.map(a => `• ${a}`).join("\n") +
        `\n\n_Sistema auto-regulado pelo Guardião._`
      );
    }

    return NextResponse.json({
      ok: alertas.length === 0,
      alertas,
      disparados,
      squadStatus,
    });
  } catch (err) {
    await alertarTelegram("🚨", "GUARDIÃO — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
