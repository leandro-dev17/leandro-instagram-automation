/**
 * FISCAL ANDRÉ API — Verifica se rotas críticas respondem 200 a cada 5 min
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

const ROTAS = [
  { path: "/api/auth/me",        esperado: [200, 401] },
  { path: "/api/admin/stats",    esperado: [200, 401, 403] },
  { path: "/",                   esperado: [200] },
];

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const erros: string[] = [];

  for (const rota of ROTAS) {
    try {
      const inicio = Date.now();
      const res = await fetch(`${APP_URL}${rota.path}`, { signal: AbortSignal.timeout(8000) });
      const latencia = Date.now() - inicio;

      if (!rota.esperado.includes(res.status)) {
        erros.push(`${rota.path} → ${res.status} (esperado: ${rota.esperado.join("/")})`);
      } else if (latencia > 3000) {
        erros.push(`${rota.path} → lento (${latencia}ms)`);
      }
    } catch {
      erros.push(`${rota.path} → timeout ou erro de rede`);
    }
  }

  if (erros.length > 0) {
    // Item 6 (Fase 33): se `criarAlertaDedup` falhar (banco fora do ar — justo a causa mais
    // provável de rotas com problema), `criado` ficava `false` por padrão e o alerta real
    // nunca disparava. Tratado como "não duplicado" para não silenciar o caso mais grave.
    let criado = true;
    try {
      ({ criado } = await criarAlertaDedup("fiscal_api", "alto", erros.join("; ")));
    } catch { /* banco pode estar fora — alerta mesmo assim */ }
    if (criado) {
      await alertarTelegram("🔴", "Fiscal André API — ROTAS COM PROBLEMA", erros.join("\n"));
    }
  } else {
    try {
      await sql`INSERT INTO agentes_log (agente, acao, status) VALUES ('andre-api', 'verificar_rotas', 'sucesso')`;
    } catch { /* ignora */ }
  }

  return NextResponse.json({ ok: erros.length === 0, erros });
}
