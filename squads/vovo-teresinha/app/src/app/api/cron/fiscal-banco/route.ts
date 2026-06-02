import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "fiscal-banco");
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
    // Marca como inativas assinaturas ativas há mais de 30 dias sem renovação
    const agora = new Date().toISOString();

    const vencidas = await sql`
      UPDATE assinaturas
      SET status = 'inativa'
      WHERE status = 'ativa'
        AND renovada_em < ${agora}::timestamptz - INTERVAL '30 days'
      RETURNING id, usuario_id, renovada_em
    `;

    console.log(
      `[fiscal-banco] Assinaturas expiradas marcadas como inativas: ${vencidas.length}`
    );

    return NextResponse.json({
      ok: true,
      processadas: vencidas.length,
      detalhes: vencidas,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-banco] Erro ao executar fiscal do banco:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno ao processar fiscal do banco", detalhe: mensagem },
      { status: 500 }
    );
  }
}
