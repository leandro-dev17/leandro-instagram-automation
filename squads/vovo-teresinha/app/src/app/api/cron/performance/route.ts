import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const LIMITE_AVISO_MS = 1500;
const LIMITE_CRITICO_MS = 3000;

const ROTAS_CRITICAS = ["/api/receitas", "/api/configuracoes/vapid-public"];

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const medicoes: { rota: string; latencia_ms: number; status: string }[] = [];
  const alertas: string[] = [];

  for (const rota of ROTAS_CRITICAS) {
    const inicio = Date.now();
    try {
      await fetch(`${APP_URL}${rota}`, { signal: AbortSignal.timeout(10000) });
      const latencia = Date.now() - inicio;
      let status = "ok";
      if (latencia > LIMITE_CRITICO_MS) {
        status = "critico";
        alertas.push(`🔴 ${rota} — ${latencia}ms (crítico!)`);
      } else if (latencia > LIMITE_AVISO_MS) {
        status = "lento";
        alertas.push(`🟡 ${rota} — ${latencia}ms (lento)`);
      }
      medicoes.push({ rota, latencia_ms: latencia, status });
    } catch {
      const latencia = Date.now() - inicio;
      medicoes.push({ rota, latencia_ms: latencia, status: "timeout" });
      alertas.push(`🔴 ${rota} — timeout após ${latencia}ms`);
    }
  }

  // Verifica banco
  const inicioDb = Date.now();
  try {
    await sql`SELECT 1`;
    const latDb = Date.now() - inicioDb;
    medicoes.push({ rota: "neon_db", latencia_ms: latDb, status: latDb > 1000 ? "lento" : "ok" });
    if (latDb > 1000) alertas.push(`🟡 Neon DB — ${latDb}ms (lento)`);
  } catch {
    alertas.push(`🔴 Neon DB — indisponível`);
  }

  if (alertas.length > 0) {
    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    await enviarTelegram(
      `⚡ <b>Performance — ${hora}</b>\n\n` +
        alertas.join("\n") +
        `\n\n<i>Verifique os logs no Vercel.</i>`
    );
  }

  return NextResponse.json({ ok: alertas.length === 0, medicoes, alertas });
}
