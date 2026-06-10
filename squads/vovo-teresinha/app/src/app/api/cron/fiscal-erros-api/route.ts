import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "fiscal-erros-api");
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
    // Garante estrutura da tabela
    await sql`
      CREATE TABLE IF NOT EXISTS logs_erros_api (
        id SERIAL PRIMARY KEY,
        endpoint TEXT NOT NULL,
        erro TEXT,
        criada_em TIMESTAMPTZ DEFAULT NOW()
      )
    `;

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
