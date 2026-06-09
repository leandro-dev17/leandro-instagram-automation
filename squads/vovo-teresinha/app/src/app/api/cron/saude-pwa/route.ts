import { NextRequest, NextResponse } from "next/server";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/cron-auth";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "saude-pwa");
  if (!auth.ok) {
    return NextResponse.json(
      {
        erro: "Não autorizado",
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
  }

  const problemas: string[] = [];
  const checks: Record<string, boolean> = {};

  // Verifica manifest.json
  try {
    const res = await fetch(`${APP_URL}/manifest.json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) {
      problemas.push(`manifest.json retornou ${res.status}`);
      checks.manifest = false;
    } else {
      const manifest = await res.json();
      const camposObrigatorios = ["name", "icons", "start_url", "display"];
      const faltando = camposObrigatorios.filter((c) => !manifest[c]);
      if (faltando.length > 0) {
        problemas.push(`manifest.json sem campos: ${faltando.join(", ")}`);
        checks.manifest = false;
      } else {
        checks.manifest = true;
      }
    }
  } catch {
    problemas.push("manifest.json inacessível (timeout)");
    checks.manifest = false;
  }

  // Verifica Service Worker
  try {
    const res = await fetch(`${APP_URL}/sw.js`, { signal: AbortSignal.timeout(8000) });
    checks.sw = res.ok;
    if (!res.ok) problemas.push(`sw.js retornou ${res.status}`);
  } catch {
    problemas.push("sw.js inacessível");
    checks.sw = false;
  }

  // Verifica ícones
  for (const icone of ["/selo-vovo.png", "/icon-512.png"]) {
    try {
      const res = await fetch(`${APP_URL}${icone}`, { signal: AbortSignal.timeout(5000) });
      checks[icone] = res.ok;
      if (!res.ok) problemas.push(`Ícone ${icone} retornou ${res.status}`);
    } catch {
      problemas.push(`Ícone ${icone} inacessível`);
      checks[icone] = false;
    }
  }

  // Verifica VAPID configurado
  checks.vapid = !!process.env.VAPID_PUBLIC_KEY && !!process.env.VAPID_PRIVATE_KEY;
  if (!checks.vapid) problemas.push("VAPID keys não configuradas");

  if (problemas.length > 0) {
    const data = new Date().toLocaleDateString("pt-BR");
    await enviarTelegram(
      `💻 <b>Saúde do PWA — ${data}</b>\n\n` +
        `⚠️ Problemas detectados:\n` +
        problemas.map((p) => `❌ ${p}`).join("\n") +
        `\n\nVerifique os arquivos públicos do app.`
    );
  }

  return NextResponse.json({ ok: problemas.length === 0, checks, problemas });
}
