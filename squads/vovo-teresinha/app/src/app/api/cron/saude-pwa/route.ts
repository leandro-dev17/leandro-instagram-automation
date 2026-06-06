import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "saude-pwa");
  if (!auth.ok) {
    return NextResponse.json(
      {
        erro: "Não autorizado",
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Verifica saúde geral do PWA: banco acessível, tabelas principais respondem
    const checks: Record<string, boolean> = {};
    const erros: Record<string, string> = {};

    // Check 1: banco acessível
    try {
      await sql`SELECT 1`;
      checks.banco = true;
    } catch (e) {
      checks.banco = false;
      erros.banco = e instanceof Error ? e.message : String(e);
    }

    // Check 2: tabela usuários
    try {
      await sql`SELECT COUNT(*)::int FROM usuarios LIMIT 1`;
      checks.tabela_usuarios = true;
    } catch (e) {
      checks.tabela_usuarios = false;
      erros.tabela_usuarios = e instanceof Error ? e.message : String(e);
    }

    // Check 3: tabela receitas
    try {
      await sql`SELECT COUNT(*)::int FROM receitas LIMIT 1`;
      checks.tabela_receitas = true;
    } catch (e) {
      checks.tabela_receitas = false;
      erros.tabela_receitas = e instanceof Error ? e.message : String(e);
    }

    // Check 4: tabela assinaturas
    try {
      await sql`SELECT COUNT(*)::int FROM assinaturas LIMIT 1`;
      checks.tabela_assinaturas = true;
    } catch (e) {
      checks.tabela_assinaturas = false;
      erros.tabela_assinaturas = e instanceof Error ? e.message : String(e);
    }

    // Check 5: push_subscriptions ativas
    try {
      const [{ total }] = await sql`
        SELECT COUNT(*)::int AS total FROM push_subscriptions WHERE ativo = true
      `;
      checks.push_subscriptions = true;
      console.log(`[saude-pwa] Push subscriptions ativas: ${total}`);
    } catch (e) {
      checks.push_subscriptions = false;
      erros.push_subscriptions = e instanceof Error ? e.message : String(e);
    }

    const tudo_ok = Object.values(checks).every(Boolean);

    if (!tudo_ok) {
      console.error("[saude-pwa] ⚠️ Falhas detectadas:", erros);
    } else {
      console.log("[saude-pwa] ✅ Todos os checks passaram.");
    }

    return NextResponse.json({
      ok: tudo_ok,
      checks,
      ...(Object.keys(erros).length > 0 && { erros }),
      verificado_em: new Date().toISOString(),
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[saude-pwa] Erro inesperado:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no saude-pwa", detalhe: mensagem },
      { status: 500 }
    );
  }
}
