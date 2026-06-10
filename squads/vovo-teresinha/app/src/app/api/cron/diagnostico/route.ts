/**
 * /api/cron/diagnostico — Rota pública de diagnóstico de configuração de crons.
 *
 * PROPÓSITO:
 *   Permite ao operador verificar no browser (sem autenticação) se as variáveis
 *   de ambiente necessárias para os cron jobs estão corretamente configuradas.
 *   Não expõe valores sensíveis — apenas informa presença/ausência.
 *
 * ACESSO:
 *   https://receitinhas-vovo-teresinha.vercel.app/api/cron/diagnostico
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️  CAUSA RAIZ DO HTTP 401 EM TODOS OS CRONS:
 * ─────────────────────────────────────────────────────────────────────────────
 *   O Vercel SÓ injeta o header "x-vercel-cron: 1" (que autoriza automaticamente
 *   os disparos agendados) quando a variável CRON_SECRET está definida nas
 *   Environment Variables do projeto com escopo Production.
 *
 *   Sem CRON_SECRET → Vercel não injeta o header → cronAutorizado() retorna
 *   { ok: false } → todos os handlers retornam 401.
 *
 * ✅ SOLUÇÃO (ação humana no Vercel Dashboard — ~2 minutos):
 *   1. https://vercel.com/dashboard → [projeto] → Settings → Environment Variables
 *   2. Clique em "Add New"
 *   3. Key:   CRON_SECRET
 *      Value: <gere com: openssl rand -hex 32>
 *      Environments: ✅ Production  (marque Preview também se quiser testar lá)
 *   4. "Save"
 *   5. Deployments → último deploy → "..." → "Redeploy" (sem cache)
 *   6. Após redeploy, acesse esta rota novamente — deve mostrar cron_secret: true
 *      e todos os crons voltarão a funcionar no próximo disparo agendado.
 *
 * Ref: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { NextResponse } from "next/server";

// Lista de todos os cron jobs declarados no vercel.json
const CRONS_DECLARADOS = [
  { nome: "agente-assinaturas", schedule: "0 2 * * *",   descricao: "Expira trials e assinaturas vencidas" },
  { nome: "fiscal-banco",       schedule: "0 3 * * *",   descricao: "Expira assinaturas sem renovação há 30d" },
  { nome: "criador-receitas",   schedule: "0 1 * * *",   descricao: "Publica receitas agendadas" },
  { nome: "fiscal-diario",      schedule: "0 6 * * *",   descricao: "Resumo diário de métricas" },
  { nome: "fiscal-erros-api",   schedule: "0 7 * * *",   descricao: "Auditoria de erros nas últimas 24h" },
  { nome: "fiscal-login",       schedule: "0 */6 * * *", descricao: "Detecta IPs suspeitos de brute-force" },
  { nome: "fiscal-pagamentos",  schedule: "0 8 * * *",   descricao: "Consistência entre assinaturas e premium" },
  { nome: "trial-expirando",    schedule: "0 10 * * *",  descricao: "Detecta trials expirando em 48h" },
  { nome: "push-diario",        schedule: "0 12 * * *",  descricao: "Coleta destinatários para push notifications" },
  { nome: "saude-pwa",          schedule: "*/15 * * * *",descricao: "Verifica manifest, SW e ícones do PWA" },
];

// Variáveis obrigatórias para funcionamento dos crons
const VARS_OBRIGATORIAS = [
  {
    nome: "CRON_SECRET",
    critica: true,
    impacto: "🚨 SEM ESTA VARIÁVEL TODOS OS CRONS RETORNAM HTTP 401",
    instrucao: "openssl rand -hex 32  →  cole como valor no Vercel Dashboard",
  },
  {
    nome: "DATABASE_URL",
    critica: true,
    impacto: "fiscal-banco, fiscal-diario, agente-assinaturas e outros falharão com erro 500",
    instrucao: "String de conexão Neon PostgreSQL (pooled ou direct)",
  },
  {
    nome: "TELEGRAM_BOT_TOKEN",
    critica: false,
    impacto: "Alertas via Telegram não serão enviados (saude-pwa, fiscal-pagamentos afetados)",
    instrucao: "Token do bot obtido via @BotFather no Telegram",
  },
  {
    nome: "TELEGRAM_CHAT_ID",
    critica: false,
    impacto: "Alertas via Telegram não serão enviados",
    instrucao: "ID do chat/grupo para onde os alertas devem ir",
  },
  {
    nome: "VAPID_PUBLIC_KEY",
    critica: false,
    impacto: "saude-pwa reportará VAPID não configurado; push notifications não funcionarão",
    instrucao: "Gere com: npx web-push generate-vapid-keys",
  },
  {
    nome: "VAPID_PRIVATE_KEY",
    critica: false,
    impacto: "saude-pwa reportará VAPID não configurado; push notifications não funcionarão",
    instrucao: "Gerada junto com VAPID_PUBLIC_KEY",
  },
];

export async function GET() {
  const isProd = process.env.NODE_ENV === "production";

  // Verifica cada variável (apenas presença, nunca o valor)
  const statusVars = VARS_OBRIGATORIAS.map((v) => ({
    variavel: v.nome,
    presente: !!process.env[v.nome],
    critica: v.critica,
    impacto: v.impacto,
    instrucao: v.instrucao,
  }));

  const varsCriticasAusentes = statusVars.filter((v) => v.critica && !v.presente);
  const varsOpcionaisAusentes = statusVars.filter((v) => !v.critica && !v.presente);

  // Avalia o estado geral
  const cronSecretPresente = !!process.env.CRON_SECRET;
  const databaseUrlPresente = !!process.env.DATABASE_URL;

  const statusGeral: "CRÍTICO" | "DEGRADADO" | "OK" = varsCriticasAusentes.length > 0
    ? "CRÍTICO"
    : varsOpcionaisAusentes.length > 0
      ? "DEGRADADO"
      : "OK";

  // Monta resposta estruturada
  const resposta = {
    diagnostico: {
      status_geral: statusGeral,
      ambiente: isProd ? "production" : "development/preview",
      timestamp: new Date().toISOString(),
      crons_funcionando: cronSecretPresente,
    },

    // Problema principal
    ...(
      !cronSecretPresente
        ? {
            PROBLEMA_CRITICO: {
              descricao: "CRON_SECRET não está definido no Vercel Dashboard",
              consequencia: "TODOS OS 10 CRON JOBS RETORNAM HTTP 401 E NÃO EXECUTAM",
              solucao_passo_a_passo: [
                "1. Abra: https://vercel.com/dashboard",
                "2. Selecione o projeto 'Receitinhas da Vovó Teresinha'",
                "3. Vá em: Settings → Environment Variables",
                "4. Clique em 'Add New'",
                "5. Key: CRON_SECRET",
                "6. Value: gere com 'openssl rand -hex 32' no terminal",
                "7. Environments: marque ✅ Production (e Preview se quiser)",
                "8. Clique em 'Save'",
                "9. Vá em: Deployments → último deploy → '...' → 'Redeploy'",
                "10. Aguarde o redeploy e acesse /api/cron/diagnostico novamente",
              ],
              referencia: "https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs",
            },
          }
        : {}
    ),

    variaveis_de_ambiente: statusVars.map(({ instrucao: _, ...rest }) => rest),

    variaveis_ausentes: {
      criticas: varsCriticasAusentes.map((v) => ({
        variavel: v.variavel,
        impacto: v.impacto,
        como_resolver: VARS_OBRIGATORIAS.find((o) => o.nome === v.variavel)?.instrucao,
      })),
      opcionais: varsOpcionaisAusentes.map((v) => ({
        variavel: v.variavel,
        impacto: v.impacto,
      })),
    },

    crons_declarados: CRONS_DECLARADOS.map((c) => ({
      ...c,
      endpoint: `/api/cron/${c.nome}`,
      status: cronSecretPresente ? "✅ autorizado pelo Vercel" : "❌ bloqueado (HTTP 401 — CRON_SECRET ausente)",
    })),

    resumo_acao_necessaria: cronSecretPresente && databaseUrlPresente
      ? "✅ Configuração OK — nenhuma ação necessária."
      : [
          !cronSecretPresente && "🚨 Adicione CRON_SECRET no Vercel Dashboard e faça Redeploy",
          !databaseUrlPresente && "🚨 Adicione DATABASE_URL no Vercel Dashboard",
        ]
          .filter(Boolean)
          .join(" | "),
  };

  // HTTP 503 se há problemas críticos (facilita monitoramento externo)
  const httpStatus = statusGeral === "CRÍTICO" ? 503 : 200;

  return NextResponse.json(resposta, { status: httpStatus });
}
