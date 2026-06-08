import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "fiscal-diario");
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
    // Resumo diário: conta usuários ativos, receitas criadas nas últimas 24h
    const agora = new Date();
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [{ total_usuarios }] = await sql`
      SELECT COUNT(*)::int AS total_usuarios FROM usuarios
    `;

    const [{ total_assinaturas_ativas }] = await sql`
      SELECT COUNT(*)::int AS total_assinaturas_ativas
      FROM assinaturas
      WHERE status = 'ativo'
    `;

    const [{ receitas_24h }] = await sql`
      SELECT COUNT(*)::int AS receitas_24h
      FROM receitas
      WHERE created_at >= ${ontem}::timestamptz
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
