/**
 * lib/cron-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo centralizado de autenticação para rotas de cron job.
 *
 * COMPORTAMENTO (ordem de verificação):
 *
 *  1. CRON_SECRET definido → valida "Authorization: Bearer <secret>".
 *     Aceita também requisições vindas do próprio Vercel Cron
 *     (header "x-vercel-cron: 1") como camada extra de segurança nativa.
 *
 *  2. CRON_SECRET ausente em produção → aceita SOMENTE via header nativo
 *     do Vercel Cron ("x-vercel-cron: 1"), logando aviso crítico.
 *     ⚠️  Configure CRON_SECRET + faça redeploy o quanto antes.
 *
 *  3. CRON_SECRET ausente fora de produção → libera sem restrição (dev/preview).
 *
 * IMPORTANTE — por que NÃO usar headers no vercel.json:
 *  O Vercel NÃO interpola variáveis de ambiente (${VAR}) dentro de campos
 *  "headers" do vercel.json. A string seria enviada literalmente como
 *  "Bearer ${CRON_SECRET}", causando 401 em todos os jobs.
 *  Por isso, a autenticação primária em produção usa o header nativo
 *  "x-vercel-cron: 1", injetado automaticamente pelo Vercel em cada
 *  disparo de cron — sem necessidade de configuração manual de headers.
 *
 * CONFIGURAÇÃO RECOMENDADA:
 *  • Vercel Dashboard → Settings → Environment Variables → Production:
 *      CRON_SECRET = <valor secreto longo e aleatório>
 *  • O mesmo valor pode ser usado por chamadas externas/manuais via:
 *      Authorization: Bearer <CRON_SECRET>
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
 *  - Header "x-vercel-cron: 1"  (disparos automáticos do Vercel Cron)
 *  - Header "Authorization: Bearer <CRON_SECRET>"  (chamadas manuais/externas)
 *
 * @param req     - NextRequest recebido pelo handler
 * @param context - Nome do endpoint para logging, ex: "fiscal-banco"
 */
export function cronAutorizado(req: NextRequest, context: string): AuthResult {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  const isVercelCron = req.headers.get("x-vercel-cron") === "1";

  // ── CRON_SECRET definido: aceita Vercel Cron nativo OU Bearer token ────────
  if (secret) {
    if (isVercelCron) {
      // Disparo legítimo do scheduler do Vercel — header nativo confiável
      return { ok: true };
    }

    const authHeader = req.headers.get("authorization") ?? "";
    const esperado = `Bearer ${secret}`;

    if (authHeader === esperado) {
      return { ok: true };
    }

    const preview =
      authHeader.substring(0, 15) + (authHeader.length > 15 ? "…" : "");
    console.warn(
      `[${context}] Header de autorização inválido. ` +
        `Recebido: "${preview}" (esperado: "Bearer ***" ou header x-vercel-cron). ` +
        "Verifique se o chamador está enviando o header correto."
    );
    return { ok: false, motivo: "header_invalido" };
  }

  // ── CRON_SECRET ausente ────────────────────────────────────────────────────
  if (isProd) {
    if (isVercelCron) {
      console.error(
        `[${context}] 🚨 CRON_SECRET ausente nas variáveis de ambiente de produção! ` +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy IMEDIATAMENTE. " +
          "Requisição ACEITA temporariamente via header nativo Vercel Cron."
      );
      return { ok: true, motivo: "secret_ausente" };
    }

    // Não veio do Vercel Cron e não há secret → bloqueia
    console.error(
      `[${context}] 🚨 CRON_SECRET ausente e requisição não veio do Vercel Cron. ` +
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
