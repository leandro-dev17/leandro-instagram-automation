/**
 * GET /api/cron/diagnostico
 *
 * Endpoint de auto-diagnóstico dos crons — NÃO requer autenticação
 * propositalmente, pois serve para confirmar se CRON_SECRET está presente.
 *
 * Remove ou proteja este endpoint após resolver o incidente.
 *
 * Criado automaticamente pelo Guardião Autônomo em 30/05/2026 às 14:55 BRT
 * para diagnosticar o 401 simultâneo em todos os 10 crons.
 */

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

export async function GET() {
  const cronSecretPresente = !!process.env.CRON_SECRET;
  const databaseUrlPresente = !!process.env.DATABASE_URL;
  const nodeEnv = process.env.NODE_ENV ?? "não definido";

  const status = cronSecretPresente ? "ok" : "critico";

  const diagnostico = {
    status,
    timestamp: new Date().toISOString(),
    ambiente: nodeEnv,
    variaveis: {
      CRON_SECRET: cronSecretPresente
        ? "✅ presente"
        : "❌ AUSENTE — causa raiz do HTTP 401 em todos os crons",
      DATABASE_URL: databaseUrlPresente
        ? "✅ presente"
        : "❌ AUSENTE — causará falhas nas queries SQL",
    },
    instrucoes_correcao: cronSecretPresente
      ? null
      : [
          "1. Acesse: https://vercel.com → seu projeto → Settings → Environment Variables",
          "2. Adicione a variável: CRON_SECRET",
          "3. Valor: uma string secreta longa e aleatória (ex: openssl rand -hex 32)",
          "4. Marque os ambientes: Production (obrigatório), Preview, Development",
          "5. Clique em Save",
          "6. Acesse: Deployments → clique nos 3 pontos do último deploy → Redeploy",
          "7. Aguarde o redeploy concluir e teste um cron manualmente",
        ],
    crons_afetados: [
      "/api/cron/fiscal-banco",
      "/api/cron/fiscal-diario",
      "/api/cron/fiscal-erros-api",
      "/api/cron/fiscal-login",
      "/api/cron/fiscal-pagamentos",
      "/api/cron/trial-expirando",
      "/api/cron/agente-assinaturas",
      "/api/cron/push-diario",
      "/api/cron/criador-receitas",
      "/api/cron/saude-pwa",
    ],
  };

  return NextResponse.json(diagnostico, {
    status: cronSecretPresente ? 200 : 503,
  });
}
