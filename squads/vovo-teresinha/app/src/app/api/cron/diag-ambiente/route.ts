/**
 * GET /api/cron/diag-ambiente
 *
 * Endpoint de diagnóstico de ambiente — NÃO expõe segredos, apenas confirma
 * presença/ausência de variáveis críticas e testa a conectividade com o banco.
 *
 * Protegido pelo mesmo guard CRON_SECRET dos demais crons.
 * Em produção, se CRON_SECRET estiver ausente, retorna 503 (não 401) para
 * distinguir do caso em que o segredo existe mas é inválido.
 *
 * Uso: chamar este endpoint primeiro para confirmar que o ambiente está OK
 * antes de investigar falhas nos demais crons.
 */
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ─── tipos ──────────────────────────────────────────────────────────────────
interface CheckResult {
  ok: boolean;
  detalhe: string;
}

// ─── helpers ────────────────────────────────────────────────────────────────

/** Verifica presença (sem expor valor) das env vars críticas. */
function checarEnvVars(): Record<string, CheckResult> {
  const vars = ["CRON_SECRET", "DATABASE_URL"] as const;
  return Object.fromEntries(
    vars.map((v) => [
      v,
      process.env[v]
        ? { ok: true, detalhe: "presente" }
        : { ok: false, detalhe: "AUSENTE — configure em Vercel → Settings → Environment Variables → Production e faça redeploy" },
    ])
  );
}

/** Testa conectividade com o Neon com timeout explícito de 8 s. */
async function checarBanco(): Promise<CheckResult> {
  if (!process.env.DATABASE_URL) {
    return { ok: false, detalhe: "DATABASE_URL ausente — teste de banco ignorado" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);

  try {
    const sql = neon(process.env.DATABASE_URL);
    // query mínima — apenas confirma que a conexão HTTP funciona
    await sql`SELECT 1 AS ping`;
    clearTimeout(timer);
    return { ok: true, detalhe: "conexão OK" };
  } catch (err: unknown) {
    clearTimeout(timer);
    const msg = err instanceof Error ? err.message : String(err);
    const isAbort = err instanceof Error && err.name === "AbortError";
    return {
      ok: false,
      detalhe: isAbort
        ? "timeout de 8 s excedido — banco Neon não respondeu (verifique se o projeto Neon está ativo / não suspenso)"
        : `erro de conexão: ${msg}`,
    };
  }
}

/** Guard idêntico ao dos demais crons — mas retorna 503 quando o próprio
 *  CRON_SECRET está ausente, para distinguir "segredo ausente" de "segredo errado". */
function autorizado(req: NextRequest): { ok: boolean; status: number; motivo: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[diag-ambiente] CRON_SECRET ausente — todos os crons estão retornando 401. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      // 503 em vez de 401 para distinguir "segredo ausente" de "segredo inválido"
      return { ok: false, status: 503, motivo: "CRON_SECRET ausente no ambiente de produção" };
    }
    console.warn("[diag-ambiente] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true, status: 200, motivo: "" };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  if (authHeader !== `Bearer ${secret}`) {
    return { ok: false, status: 401, motivo: "header Authorization inválido" };
  }

  return { ok: true, status: 200, motivo: "" };
}

// ─── handler ────────────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  const auth = autorizado(req);

  // Se CRON_SECRET ausente em produção → retorna 503 com diagnóstico imediato
  // (não precisa de auth para reportar que o próprio segredo está faltando)
  if (!auth.ok && auth.status === 503) {
    const envChecks = checarEnvVars();
    return NextResponse.json(
      {
        ok: false,
        problema_critico: auth.motivo,
        instrucao: "1. Acesse Vercel Dashboard → Settings → Environment Variables. " +
          "2. Adicione CRON_SECRET com um valor seguro (ex: openssl rand -hex 32). " +
          "3. Marque o ambiente 'Production'. " +
          "4. Clique em Redeploy (sem usar cache). " +
          "5. Todos os crons voltarão a funcionar automaticamente.",
        env_vars: envChecks,
      },
      { status: 503 }
    );
  }

  if (!auth.ok) {
    return NextResponse.json({ erro: "Não autorizado", motivo: auth.motivo }, { status: 401 });
  }

  // Diagnóstico completo
  const [envChecks, bancoCheck] = await Promise.all([
    Promise.resolve(checarEnvVars()),
    checarBanco(),
  ]);

  const tudo_ok = Object.values(envChecks).every((c) => c.ok) && bancoCheck.ok;

  const resultado = {
    ok: tudo_ok,
    verificado_em: new Date().toISOString(),
    node_env: process.env.NODE_ENV ?? "(não definido)",
    env_vars: envChecks,
    banco_neon: bancoCheck,
    ...(tudo_ok
      ? { mensagem: "Ambiente OK — se crons ainda retornam 401, verifique se o CRON_SECRET no Vercel corresponde ao valor usado nas chamadas." }
      : { mensagem: "⚠️  Há problemas de configuração — veja os campos acima para detalhes." }),
  };

  console.log("[diag-ambiente]", JSON.stringify(resultado));

  return NextResponse.json(resultado, { status: tudo_ok ? 200 : 503 });
}
