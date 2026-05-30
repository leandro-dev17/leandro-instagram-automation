import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-erros-api] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    console.warn("[fiscal-erros-api] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-erros-api] Header Authorization inválido. " +
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
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Verifica erros de API registrados nas últimas 24h
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const erros = await sql`
      SELECT endpoint, COUNT(*)::int AS total, MAX(criada_em) AS ultimo_erro
      FROM logs_erros_api
      WHERE criada_em >= ${ontem}::timestamptz
      GROUP BY endpoint
      ORDER BY total DESC
      LIMIT 20
    `;

    console.log(`[fiscal-erros-api] Endpoints com erros nas últimas 24h: ${erros.length}`);

    return NextResponse.json({
      ok: true,
      periodo: "24h",
      endpoints_com_erros: erros.length,
      detalhes: erros,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-erros-api] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no fiscal de erros de API", detalhe: mensagem },
      { status: 500 }
    );
  }
}
