/**
 * lib/auth-cron.ts — wrapper de compatibilidade sobre lib/cron-auth.ts
 *
 * Agentes legados que importam daqui continuam funcionando.
 * Novos agentes devem importar de lib/cron-auth.ts diretamente para
 * obter o resultado detalhado { ok, motivo }.
 */
import { NextRequest } from "next/server";
import { cronAutorizado as _cronAutorizado } from "./cron-auth";

export function cronAutorizado(req: NextRequest): boolean {
  return _cronAutorizado(req, "cron").ok;
}
