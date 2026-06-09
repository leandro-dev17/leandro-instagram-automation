/**
 * lib/cron-auth.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Módulo centralizado de autenticação para rotas de cron job.
 *
 * COMPORTAMENTO (ordem de verificação):
 *
 *  1. Header "x-vercel-cron" presente com qualquer valor não-vazio
 *     (disparo automático do Vercel Cron):
 *     → SEMPRE aceito. O Vercel injeta este header exclusivamente em disparos
 *       legítimos da sua infraestrutura de cron — não é forjável externamente.
 *
 *  2. Header "x-vercel-cron" ausente (chamada manual / externa):
 *     a. CRON_SECRET definido  → exige "Authorization: Bearer <secret>".
 *     b. CRON_SECRET ausente em produção → BLOQUEIA sempre.
 *     c. CRON_SECRET ausente fora de produção → libera (dev/preview).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  CAUSA RAIZ DO BUG (HTTP 401 em todos os crons):
 * ─────────────────────────────────────────────────────────────────────────────
 *  O Vercel SÓ injeta o header "x-vercel-cron: 1" nas requisições de cron
 *  quando a variável de ambiente CRON_SECRET está definida no projeto.
 *  Sem CRON_SECRET configurado em produção, o Vercel NÃO injeta o header,
 *  isVercelCron = false, e todos os crons caem no bloco de bloqueio → 401.
 *
 * ✅ SOLUÇÃO OBRIGATÓRIA (ação humana necessária no Vercel Dashboard):
 *  1. Acesse: Vercel Dashboard → [projeto] → Settings → Environment Variables
 *  2. Adicione: CRON_SECRET = <string longa e aleatória>
 *     Gere com: openssl rand -hex 32
 *     Escopo: Production (e Preview se quiser testar lá também)
 *  3. Clique em "Save"
 *  4. Dispare um redeploy manual (Deployments → "..." → Redeploy) OU aguarde
 *     o próximo deploy automático via git push.
 *  5. Após o redeploy, o Vercel passará a injetar "x-vercel-cron: 1" +
 *     "Authorization: Bearer <CRON_SECRET>" automaticamente em cada disparo.
 *
 * CHAMADAS MANUAIS / EXTERNAS (ex: curl, Postman, outro serviço):
 *  curl -H "Authorization: Bearer <CRON_SECRET>" \
 *       https://seu-app.vercel.app/api/cron/fiscal-banco
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextRequest } from "next/server";

export interface AuthResult {
  ok: boolean;
  motivo?: "secret_ausente" | "header_invalido";
}

// ─────────────────────────────────────────────────────────────────────────────
// Alerta de inicialização: dispara UMA VEZ no cold start se CRON_SECRET não
// estiver definido em produção. Torna o problema imediatamente visível nos
// logs do Vercel sem precisar esperar uma requisição chegar.
// ─────────────────────────────────────────────────────────────────────────────
if (
  process.env.NODE_ENV === "production" &&
  !process.env.CRON_SECRET
) {
  console.error(
    "\n" +
    "╔══════════════════════════════════════════════════════════════════╗\n" +
    "║  [cron-auth] 🚨 CONFIGURAÇÃO CRÍTICA AUSENTE: CRON_SECRET       ║\n" +
    "╠══════════════════════════════════════════════════════════════════╣\n" +
    "║  CONSEQUÊNCIA: TODOS os cron jobs estão retornando HTTP 401.    ║\n" +
    "║  O Vercel NÃO injeta o header 'x-vercel-cron' sem esta          ║\n" +
    "║  variável definida nas Environment Variables do projeto.        ║\n" +
    "╠══════════════════════════════════════════════════════════════════╣\n" +
    "║  AÇÃO NECESSÁRIA (operador humano):                             ║\n" +
    "║  1) Vercel Dashboard → [projeto] → Settings →                   ║\n" +
    "║     Environment Variables                                       ║\n" +
    "║  2) Adicione: CRON_SECRET = <valor aleatório seguro>            ║\n" +
    "║     Gere com: openssl rand -hex 32                              ║\n" +
    "║     Escopo: Production                                          ║\n" +
    "║  3) Salve e execute um Redeploy manual.                         ║\n" +
    "║  Ref: https://vercel.com/docs/cron-jobs/manage-cron-jobs        ║\n" +
    "║       #securing-cron-jobs                                       ║\n" +
    "╚══════════════════════════════════════════════════════════════════╝\n"
  );

  // ── Alerta Telegram no cold start ─────────────────────────────────────────
  // Tenta notificar via Telegram imediatamente ao detectar a ausência do secret.
  // Usa fetch direto para evitar import circular com lib/telegram.
  const telegramToken = process.env.TELEGRAM_BOT_TOKEN;
  const telegramChatId = process.env.TELEGRAM_CHAT_ID;
  if (telegramToken && telegramChatId) {
    const msg = encodeURIComponent(
      "🚨 <b>CRON_SECRET AUSENTE — Receitinhas da Vovó Teresinha</b>\n\n" +
      "Todos os cron jobs estão retornando HTTP 401 (Não autorizado).\n\n" +
      "<b>AÇÃO NECESSÁRIA:</b>\n" +
      "1. Vercel Dashboard → Settings → Environment Variables\n" +
      "2. Adicione: <code>CRON_SECRET = $(openssl rand -hex 32)</code>\n" +
      "   Escopo: <b>Production</b>\n" +
      "3. Salve e faça Redeploy manual\n\n" +
      "<i>Nenhum cron (fiscal-banco, fiscal-diario, agente-assinaturas, etc.) " +
      "está sendo executado até esta variável ser configurada.</i>"
    );
    fetch(
      `https://api.telegram.org/bot${telegramToken}/sendMessage` +
      `?chat_id=${telegramChatId}&parse_mode=HTML&text=${msg}`
    ).catch(() => {/* silencioso — não bloqueia o boot */});
  }
}

/**
 * Valida se a requisição possui autorização válida para crons.
 *
 * Aceita:
 *  - Header "x-vercel-cron" com qualquer valor não-vazio (disparo automático
 *    do Vercel — sempre aceito, independente do valor exato do header)
 *  - Header "Authorization: Bearer <CRON_SECRET>" sozinho (chamadas manuais/externas)
 *
 * @param req     - NextRequest recebido pelo handler
 * @param context - Nome do endpoint para logging, ex: "fiscal-banco"
 */
export function cronAutorizado(req: NextRequest, context: string): AuthResult {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  // ── Disparo automático do Vercel Cron ─────────────────────────────────────
  // O Vercel injeta "x-vercel-cron: 1" APENAS quando CRON_SECRET está definido
  // nas Environment Variables do projeto. Se este header nunca chegar, a causa
  // provável é CRON_SECRET ausente no Vercel Dashboard → ver SOLUÇÃO acima.
  const xVercelCronHeader = req.headers.get("x-vercel-cron");
  const isVercelCron =
    typeof xVercelCronHeader === "string" && xVercelCronHeader.trim() !== "";

  const authHeader = req.headers.get("authorization") ?? "";
  const bearerValido = secret ? authHeader === `Bearer ${secret}` : false;

  if (isVercelCron) {
    if (!secret) {
      // Situação inesperada: Vercel injetou x-vercel-cron mas CRON_SECRET não
      // está disponível no runtime. Aceita mesmo assim (header é não-forjável),
      // mas alerta para que o operador corrija o ambiente.
      console.warn(
        `[${context}] ⚠️  x-vercel-cron recebido mas CRON_SECRET não está ` +
          "disponível no runtime. Verifique se a variável foi salva com escopo " +
          "'Production' e se o redeploy foi concluído. Acesso aceito via header nativo."
      );
    } else {
      console.log(
        `[${context}] ✅ Disparo legítimo do Vercel Cron (x-vercel-cron: "${xVercelCronHeader}").`
      );
    }
    return { ok: true };
  }

  // ── Chamada manual / externa (sem x-vercel-cron) ──────────────────────────
  if (secret) {
    if (bearerValido) {
      console.log(`[${context}] ✅ Chamada manual autenticada via Bearer token.`);
      return { ok: true };
    }

    const preview =
      authHeader.substring(0, 15) + (authHeader.length > 15 ? "…" : "");
    console.warn(
      `[${context}] ❌ Header de autorização inválido para chamada manual. ` +
        `Recebido: "${preview}" (esperado: "Authorization: Bearer <CRON_SECRET>").`
    );
    return { ok: false, motivo: "header_invalido" };
  }

  // ── CRON_SECRET ausente, sem header nativo ────────────────────────────────
  if (isProd) {
    console.error(
      `[${context}] 🚨 BLOQUEADO — CRON_SECRET ausente e requisição não veio do Vercel Cron. ` +
        "TODOS OS CRONS ESTÃO FALHANDO COM 401. " +
        "AÇÃO NECESSÁRIA: Vercel Dashboard → Settings → Environment Variables → " +
        "Adicione CRON_SECRET=<openssl rand -hex 32> com escopo Production → " +
        "Salve → Redeploy. " +
        "Ref: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs"
    );
    return { ok: false, motivo: "secret_ausente" };
  }

  // Fora de produção (desenvolvimento / preview): libera sem aviso crítico
  console.warn(
    `[${context}] ⚠️  CRON_SECRET não definido — acesso permitido fora de produção.`
  );
  return { ok: true };
}
