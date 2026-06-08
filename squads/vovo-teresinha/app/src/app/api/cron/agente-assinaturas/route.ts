import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "agente-assinaturas");
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
    const agora = new Date().toISOString();

    // Expira assinaturas trial vencidas
    const trialsExpirados = await sql`
      UPDATE assinaturas
      SET status = 'expirada'
      WHERE status = 'trial'
        AND renovada_em < ${agora}::timestamptz
      RETURNING id, usuario_id, renovada_em
    `;

    // Expira assinaturas ativas sem renovação há mais de 30 dias
    const ativasExpiradas = await sql`
      UPDATE assinaturas
      SET status = 'expirada'
      WHERE status = 'ativo'
        AND renovada_em < ${agora}::timestamptz - INTERVAL '30 days'
      RETURNING id, usuario_id, renovada_em
    `;

    console.log(
      `[agente-assinaturas] Trials expirados: ${trialsExpirados.length} | Ativas expiradas: ${ativasExpiradas.length}`
    );

    return NextResponse.json({
      ok: true,
      trials_expirados: trialsExpirados.length,
      ativas_expiradas: ativasExpiradas.length,
      detalhes_trials: trialsExpirados,
      detalhes_ativas: ativasExpiradas,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[agente-assinaturas] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no agente de assinaturas", detalhe: mensagem },
      { status: 500 }
    );
  }
}
