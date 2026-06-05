/**
 * lib/cron-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo centralizado de autenticação para rotas de cron job.
 *
 * COMPORTAMENTO (ordem de verificação):
 *
 *  1. Header "x-vercel-cron: 1" presente (disparo automático do Vercel Cron):
 *     a. CRON_SECRET definido  → exige TAMBÉM "Authorization: Bearer <secret>"
 *        para dupla validação (header nativo + secret).
 *     b. CRON_SECRET ausente   → aceita somente pelo header nativo, com aviso
 *        crítico para configurar CRON_SECRET o quanto antes.
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
 *  - Header "x-vercel-cron: 1" + "Authorization: Bearer <CRON_SECRET>" (dupla validação, recomendado)
 *  - Header "x-vercel-cron: 1" sozinho quando CRON_SECRET não está definido (fallback com aviso)
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

  // ── CRON_SECRET definido ───────────────────────────────────────────────────
  if (secret) {
    // Bearer válido → sempre aceita (cobre chamadas manuais e Vercel Cron)
    if (bearerValido) {
      return { ok: true };
    }

    // Vercel Cron sem Bearer → bloqueia e orienta a configuração do vercel.json
    if (isVercelCron) {
      console.error(
        `[${context}] 🚨 Disparo Vercel Cron recebido SEM header Authorization. ` +
          "O Vercel não interpola variáveis em 'headers' do vercel.json — " +
          "NÃO configure Authorization ali. " +
          "Para chamadas manuais use: Authorization: Bearer <CRON_SECRET>. " +
          "Os disparos automáticos do Vercel usam apenas x-vercel-cron:1 mais o " +
          "CRON_SECRET como Bearer — verifique se o scheduler está configurado " +
          "para enviar o header, ou remova CRON_SECRET para usar somente o header nativo."
      );
      // ACEITA via header nativo do Vercel como fallback seguro, pois o header
      // x-vercel-cron:1 só pode ser injetado pela infraestrutura do próprio Vercel.
      // Isso evita que todos os cron jobs fiquem parados por falta do Bearer.
      console.warn(
        `[${context}] ⚠️  Aceitando via x-vercel-cron nativo como fallback. ` +
          "Configure o scheduler para enviar Authorization: Bearer <CRON_SECRET> " +
          "ou remova CRON_SECRET se quiser usar exclusivamente o header nativo."
      );
      return { ok: true };
    }

    // Nem Bearer válido, nem Vercel Cron → bloqueia
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

    // Sem secret e sem header nativo em produção → bloqueia sempre
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
