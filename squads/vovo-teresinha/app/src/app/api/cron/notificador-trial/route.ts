/**
 * NOTIFICADOR NATASHA TRIAL — Notificadora de Trial Expirando
 * Descontinuado: trial agora é com cartão via assinatura MP (free_trial do PreApproval).
 * Mantido registrado no vercel.json/hierarquia para não disparar alerta de cron sumido.
 */
import { NextRequest, NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/auth-cron";
import { resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  await resolverFalhas("notificador-trial");
  return NextResponse.json({ ok: true, msg: "Descontinuado: trial agora é com cartão via assinatura MP" });
}
