import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-diario] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    console.warn("[fiscal-diario] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-diario] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        "(esperado: \"Bearer ***\")."
    );
    return { ok: false, motivo: "header_invalido" };
  }

  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = autorizado(req);
  if (!auth.ok) {
    return NextResponse.json(
      {
        erro: "Não autorizado",
        diagnostico: auth.motivo,
        instrucao:
          auth.motivo === "secret_ausente"
            ? "Adicione a variável CRON_SECRET em Vercel Dashboard → Settings → Environment Variables → Production e faça redeploy."
            : "Verifique se o valor de CRON_SECRET no ambiente Vercel está correto e corresponde ao header Authorization enviado.",
      },
      { status: 401 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Resumo diário: conta usuários ativos, receitas criadas nas últimas 24h
    const agora = new Date();
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [{ total_usuarios }] = await sql`
      SELECT COUNT(*)::int AS total_usuarios FROM usuarios
    `;

    const [{ total_assinaturas_ativas }] = await sql`
      SELECT COUNT(*)::int AS total_assinaturas_ativas
      FROM assinaturas
      WHERE status = 'ativa'
    `;

    const [{ receitas_24h }] = await sql`
      SELECT COUNT(*)::int AS receitas_24h
      FROM receitas
      WHERE criada_em >= ${ontem}::timestamptz
    `;

    console.log(
      `[fiscal-diario] usuarios=${total_usuarios} assinaturas_ativas=${total_assinaturas_ativas} receitas_24h=${receitas_24h}`
    );

    return NextResponse.json({
      ok: true,
      total_usuarios,
      total_assinaturas_ativas,
      receitas_24h,
      gerado_em: agora.toISOString(),
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-diario] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no fiscal diário", detalhe: mensagem },
      { status: 500 }
    );
  }
}
