/**
 * FISCAL LISA LOGIN — Testa login/cadastro/reset a cada 5 min
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

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

    // Testa rota de login (POST vazio deve retornar 400, não 500)
    const testeLogin = await fetch(`${APP_URL}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: AbortSignal.timeout(5000),
    });
    if (testeLogin.status === 500) {
      problemas.push(`/api/auth/login retornou 500`);
    }

    if (problemas.length > 0) {
      await alertarTelegram("🔴", "Fiscal Lisa Login — PROBLEMA", problemas.join("\n"));
      await sql`INSERT INTO alertas (tipo, severidade, mensagem) VALUES ('fiscal_login', 'alto', ${problemas.join("; ")})`;
    } else {
      await sql`INSERT INTO agentes_log (agente, acao, status) VALUES ('lisa-login', 'verificar_auth', 'sucesso')`;
    }

    return NextResponse.json({ ok: problemas.length === 0, problemas });
  } catch (err) {
    await alertarTelegram("🔴", "Fiscal Lisa Login — ERRO CRÍTICO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
