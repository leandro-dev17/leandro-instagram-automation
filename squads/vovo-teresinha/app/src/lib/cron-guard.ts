import { NextRequest, NextResponse } from "next/server";

// ---------------------------------------------------------------------------
// cron-guard.ts — Módulo centralizado de autenticação para cron jobs
//
// Todos os endpoints de cron importam daqui. Mudanças na lógica de auth
// afetam todos de uma só vez, eliminando drift entre cópias.
//
// CAUSA DO INCIDENTE 29/05/2026:
//   CRON_SECRET estava ausente nas variáveis de ambiente de produção.
//   Todos os 10 crons retornaram HTTP 401 simultaneamente.
//   Solução definitiva: recriar a variável no Vercel Dashboard +
//   reimplantar. Este módulo adiciona diagnóstico mais claro nos logs.
//
// Fluxo de validação:
//  1. Em produção (NODE_ENV === "production"): CRON_SECRET obrigatório.
//     - Ausente  → 401 + log de erro detalhado com instruções de correção.
//     - Divergente → 401 + log de warning.
//  2. Fora de produção: se CRON_SECRET não estiver definido, permite a
//     chamada (facilita testes locais). Se definido, valida normalmente.
//
// Como configurar:
//   Vercel Dashboard → projeto → Settings → Environment Variables →
//   adicionar CRON_SECRET com valor forte (ex: openssl rand -hex 32) →
//   marcar "Production" → salvar → redeploy.
// ---------------------------------------------------------------------------

export type GuardResult =
  | { ok: true }
  | { ok: false; motivo: "secret_ausente" | "header_invalido"; status: 401 };

export function verificarCronAuth(
  req: NextRequest,
  tag: string
): GuardResult {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        `[${tag}] ❌ CRON_SECRET ausente em produção. ` +
          "TODOS OS CRONS estão bloqueados. " +
          "Ação imediata: Vercel Dashboard → Settings → Environment Variables → " +
          "adicionar CRON_SECRET (Production) → redeploy. " +
          "Gere um valor seguro com: openssl rand -hex 32"
      );
      return { ok: false, motivo: "secret_ausente", status: 401 };
    }
    console.warn(
      `[${tag}] ⚠️  CRON_SECRET não definido — acesso permitido (NODE_ENV=${process.env.NODE_ENV}). ` +
        "Configure a variável para testar o fluxo completo de autenticação."
    );
    return { ok: true };
  }

  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    const preview = authHeader.length > 0
      ? `"${authHeader.substring(0, 10)}${authHeader.length > 10 ? "…" : ""}"`
      : "(vazio)";
    console.warn(
      `[${tag}] ⚠️  Header Authorization não bate. ` +
        `Recebido: ${preview}. ` +
        "Verifique se CRON_SECRET no ambiente corresponde ao valor configurado no cron job."
    );
    return { ok: false, motivo: "header_invalido", status: 401 };
  }

  return { ok: true };
}

// Resposta 401 padronizada — não vaza detalhes em produção
export function respostaNaoAutorizado(
  motivo: "secret_ausente" | "header_invalido"
): NextResponse {
  return NextResponse.json(
    {
      erro: "Não autorizado",
      ...(process.env.NODE_ENV !== "production" && { diagnostico: motivo }),
    },
    { status: 401 }
  );
}
