/**
 * lib/cron-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo centralizado de autenticação para rotas de cron job.
 *
 * COMPORTAMENTO:
 *  • CRON_SECRET presente  → valida header "Authorization: Bearer <secret>"
 *  • CRON_SECRET ausente em produção → LOGA ERRO CRÍTICO e BLOQUEIA (401)
 *    para evitar execução não autenticada de jobs sensíveis.
 *  • CRON_SECRET ausente fora de produção → permite (ambiente de dev/preview)
 *
 * CONFIGURAÇÃO OBRIGATÓRIA:
 *  Vercel Dashboard → Settings → Environment Variables → Production
 *  Adicione:  CRON_SECRET = <valor secreto longo e aleatório>
 *  O mesmo valor deve estar em: vercel.json → crons → headers → Authorization: Bearer <valor>
 *  Depois faça redeploy para que a variável seja injetada no runtime.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest } from "next/server";

export interface AuthResult {
  ok: boolean;
  motivo?: "secret_ausente" | "header_invalido";
}

/**
 * Valida se a requisição possui o header de autorização correto para crons.
 *
 * @param req     - NextRequest recebido pelo handler
 * @param context - Nome do endpoint (usado nos logs), ex: "fiscal-banco"
 */
export function cronAutorizado(req: NextRequest, context: string): AuthResult {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  // ── Variável não definida ──────────────────────────────────────────────────
  if (!secret) {
    if (isProd) {
      console.error(
        `[${context}] 🚨 CRON_SECRET ausente nas variáveis de ambiente de produção. ` +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy IMEDIATAMENTE. " +
          "Requisição BLOQUEADA por segurança."
      );
      return { ok: false, motivo: "secret_ausente" };
    }

    // Fora de produção (desenvolvimento / preview): libera sem aviso crítico
    console.warn(
      `[${context}] CRON_SECRET não definido — acesso permitido fora de produção.`
    );
    return { ok: true };
  }

  // ── Variável definida: valida o header ────────────────────────────────────
  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;

  if (authHeader !== esperado) {
    const preview =
      authHeader.substring(0, 15) + (authHeader.length > 15 ? "…" : "");
    console.warn(
      `[${context}] Header Authorization inválido. ` +
        `Recebido: "${preview}" (esperado: "Bearer ***"). ` +
        "Verifique se CRON_SECRET no ambiente corresponde ao valor configurado " +
        "nos headers dos cron jobs (vercel.json) e se o chamador está enviando " +
        "o header corretamente."
    );
    return { ok: false, motivo: "header_invalido" };
  }

  return { ok: true };
}
