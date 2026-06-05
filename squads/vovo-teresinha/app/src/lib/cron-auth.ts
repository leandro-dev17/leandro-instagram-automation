/**
 * lib/cron-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo centralizado de autenticação para rotas de cron job.
 *
 * COMPORTAMENTO (ordem de verificação):
 *
 *  1. Header "x-vercel-cron: 1" presente (disparo automático do Vercel Cron):
 *     → SEMPRE aceito. O Vercel injeta este header exclusivamente em disparos
 *       legítimos da sua infraestrutura de cron — não é forjável externamente.
 *       Não exige CRON_SECRET para disparos automáticos.
 *
 *  2. Header "x-vercel-cron" ausente (chamada manual / externa):
 *     a. CRON_SECRET definido  → exige "Authorization: Bearer <secret>".
 *     b. CRON_SECRET ausente em produção → BLOQUEIA sempre.
 *     c. CRON_SECRET ausente fora de produção → libera (dev/preview).
 *
 * IMPORTANTE — por que NÃO usar headers no vercel.json:
 *  O Vercel NÃO interpola variáveis de ambiente (${VAR}) dentro de campos
 *  "headers" do vercel.json. A string seria enviada literalmente como
 *  "Bearer ${CRON_SECRET}", causando 401 em todos os jobs.
 *  A autenticação primária em produção usa o header nativo "x-vercel-cron: 1",
 *  injetado automaticamente pelo Vercel em cada disparo de cron.
 *
 * CONFIGURAÇÃO RECOMENDADA:
 *  • Vercel Dashboard → Settings → Environment Variables → Production:
 *      CRON_SECRET = <valor secreto longo e aleatório>
 *  • Redeploy após definir/alterar CRON_SECRET para que o runtime recarregue.
 *  • Chamadas manuais/externas: Authorization: Bearer <CRON_SECRET>
 *  • Não configure "headers" no vercel.json — remova-os se existirem.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest } from "next/server";

export interface AuthResult {
  ok: boolean;
  motivo?: "secret_ausente" | "header_invalido";
}

/**
 * Valida se a requisição possui autorização válida para crons.
 *
 * Aceita:
 *  - Header "x-vercel-cron: 1" (disparo automático do Vercel — sempre aceito)
 *  - Header "Authorization: Bearer <CRON_SECRET>" sozinho (chamadas manuais/externas)
 *
 * @param req     - NextRequest recebido pelo handler
 * @param context - Nome do endpoint para logging, ex: "fiscal-banco"
 */
export function cronAutorizado(req: NextRequest, context: string): AuthResult {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  const isVercelCron = req.headers.get("x-vercel-cron") === "1";
  const authHeader = req.headers.get("authorization") ?? "";
  const bearerValido = secret ? authHeader === `Bearer ${secret}` : false;

  // ── Disparo automático do Vercel Cron ─────────────────────────────────────
  // O header x-vercel-cron:1 é injetado exclusivamente pela infraestrutura do
  // Vercel — não é acessível nem forjável por chamadas externas. Basta ele para
  // autenticar disparos legítimos de cron, independentemente de CRON_SECRET.
  if (isVercelCron) {
    if (!secret) {
      console.warn(
        `[${context}] ⚠️  CRON_SECRET não definido. Configure-o em ` +
          "Vercel Dashboard → Settings → Environment Variables → Production " +
          "e faça redeploy. Aceito via header nativo x-vercel-cron."
      );
    }
    return { ok: true };
  }

  // ── Chamada manual / externa (sem x-vercel-cron) ──────────────────────────
  if (secret) {
    if (bearerValido) {
      return { ok: true };
    }

    const preview =
      authHeader.substring(0, 15) + (authHeader.length > 15 ? "…" : "");
    console.warn(
      `[${context}] Header de autorização inválido para chamada manual. ` +
        `Recebido: "${preview}" (esperado: "Authorization: Bearer <CRON_SECRET>").`
    );
    return { ok: false, motivo: "header_invalido" };
  }

  // CRON_SECRET ausente, sem header nativo
  if (isProd) {
    console.error(
      `[${context}] 🚨 CRON_SECRET ausente e requisição não veio do Vercel Cron. ` +
        "Acesse Vercel Dashboard → Settings → Environment Variables, " +
        "adicione CRON_SECRET e faça redeploy IMEDIATAMENTE. " +
        "Requisição BLOQUEADA."
    );
    return { ok: false, motivo: "secret_ausente" };
  }

  // Fora de produção (desenvolvimento / preview): libera sem aviso crítico
  console.warn(
    `[${context}] CRON_SECRET não definido — acesso permitido fora de produção.`
  );
  return { ok: true };
}
