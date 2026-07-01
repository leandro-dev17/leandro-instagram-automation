/**
 * TRIAL EXPIRANDO — Detector de Trials Expirando
 * Descontinuado: trial agora é com cartão via assinatura MP (free_trial do PreApproval).
 * Mantido registrado no vercel.json/hierarquia para não disparar alerta de cron sumido.
 */
import { NextRequest, NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/cron-auth";
import { resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "trial-expirando");
  if (!auth.ok) {
    return NextResponse.json(
      {
        erro: "Não autorizado",
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
  }

  await resolverFalhas("trial-expirando");
  return NextResponse.json({ ok: true, msg: "Descontinuado: trial agora é com cartão via assinatura MP" });
}
