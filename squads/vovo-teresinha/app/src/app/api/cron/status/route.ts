/**
 * GET /api/cron/status
 * ─────────────────────────────────────────────────────────────────────────────
 * Rota de diagnóstico PÚBLICA (sem autenticação) que informa o estado da
 * configuração de cron jobs sem expor valores sensíveis.
 *
 * Útil para:
 *  - Detectar rapidamente se CRON_SECRET está ausente (causa dos HTTP 401)
 *  - Verificar quais variáveis de ambiente obrigatórias estão configuradas
 *  - Monitoramento externo / health-check de infraestrutura
 *
 * ⚠️  Não expõe o valor de nenhuma variável — apenas se estão definidas (bool).
 * ─────────────────────────────────────────────────────────────────────────────
 */
import { NextResponse } from "next/server";

// Lista de todos os cron endpoints registrados no projeto
const CRON_ENDPOINTS = [
  "fiscal-banco",
  "fiscal-diario",
  "fiscal-erros-api",
  "fiscal-login",
  "fiscal-pagamentos",
  "trial-expirando",
  "agente-assinaturas",
  "push-diario",
  "criador-receitas",
  "saude-pwa",
] as const;

// Variáveis de ambiente obrigatórias para o funcionamento dos crons
const ENV_OBRIGATORIAS = [
  "CRON_SECRET",
  "DATABASE_URL",
  "TELEGRAM_BOT_TOKEN",
  "TELEGRAM_CHAT_ID",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "NEXT_PUBLIC_APP_URL",
] as const;

export async function GET() {
  const cronSecretOk = !!process.env.CRON_SECRET;

  // Verifica presença (não valor) de cada variável obrigatória
  const envStatus = Object.fromEntries(
    ENV_OBRIGATORIAS.map((key) => [key, !!process.env[key]])
  ) as Record<string, boolean>;

  // Variáveis faltando
  const envFaltando = ENV_OBRIGATORIAS.filter((key) => !process.env[key]);

  // Diagnóstico principal
  const problemas: string[] = [];

  if (!cronSecretOk) {
    problemas.push(
      "CRON_SECRET não está definida — TODOS os cron jobs retornam HTTP 401. " +
      "Adicione em: Vercel Dashboard → Settings → Environment Variables → " +
      "CRON_SECRET = <openssl rand -hex 32> → escopo Production → Salve → Redeploy."
    );
  }

  for (const varFaltando of envFaltando) {
    if (varFaltando !== "CRON_SECRET") {
      // CRON_SECRET já foi reportado acima com mensagem específica
      problemas.push(`Variável de ambiente ausente: ${varFaltando}`);
    }
  }

  const statusGeral = problemas.length === 0 ? "ok" : "degradado";

  return NextResponse.json(
    {
      status: statusGeral,
      crons_funcionando: cronSecretOk,
      total_endpoints: CRON_ENDPOINTS.length,
      endpoints: CRON_ENDPOINTS,
      env: envStatus,
      problemas,
      instrucoes_correcao: cronSecretOk
        ? null
        : {
            passo_1: "Vercel Dashboard → [projeto] → Settings → Environment Variables",
            passo_2: "Adicione CRON_SECRET com valor gerado por: openssl rand -hex 32",
            passo_3: "Escopo: Production (obrigatório)",
            passo_4: "Clique em Save",
            passo_5: "Deployments → último deploy → '...' → Redeploy",
            referencia: "https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs",
          },
      gerado_em: new Date().toISOString(),
      ambiente: process.env.NODE_ENV ?? "desconhecido",
    },
    {
      status: problemas.length === 0 ? 200 : 503,
      headers: {
        // Nunca cachear — deve sempre refletir o estado atual das env vars
        "Cache-Control": "no-store, no-cache, must-revalidate",
      },
    }
  );
}
