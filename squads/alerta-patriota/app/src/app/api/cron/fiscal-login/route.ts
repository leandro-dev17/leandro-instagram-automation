/**
 * FISCAL LISA LOGIN — Testa rota de sessão (/api/auth/me) a cada 5 min.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const problemas: string[] = [];

  try {
    // Testa rota de auth
    const testeMe = await fetch(`${APP_URL}/api/auth/me`, { signal: AbortSignal.timeout(5000) });
    if (testeMe.status !== 200 && testeMe.status !== 401) {
      problemas.push(`/api/auth/me retornou ${testeMe.status}`);
    }

    if (problemas.length > 0) {
      const { criado } = await criarAlertaDedup("fiscal_login", "alto", problemas.join("; "));
      if (criado) {
        await alertarTelegram("🔴", "Fiscal Lisa Login — PROBLEMA", problemas.join("\n"));
      }
    } else {
      await sql`INSERT INTO agentes_log (agente, acao, status) VALUES ('lisa-login', 'verificar_auth', 'sucesso')`;
    }

    return NextResponse.json({ ok: problemas.length === 0, problemas });
  } catch (err) {
    await alertarTelegram("🔴", "Fiscal Lisa Login — ERRO CRÍTICO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
