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
    // Marca como 'expirada' (não 'cancelado') assinaturas ativas sem renovação há mais de 30 dias.
    // CORREÇÃO: status consistente com agente-assinaturas que também usa 'expirada'.
    // 'cancelado' é reservado para cancelamentos explícitos via webhook do MercadoPago.
    const vencidas = await sql`
      UPDATE assinaturas
      SET status = 'expirada'
      WHERE status = 'ativo'
        AND renovada_em < NOW() - INTERVAL '30 days'
      RETURNING id, usuario_id, renovada_em
    `;

    // Rebaixa para 'free' os usuários premium cujas assinaturas acabaram de expirar
    // e que não possuem outra assinatura ativa.
    let premiumRebaixados = 0;
    if (vencidas.length > 0) {
      const ids = vencidas.map((r) => r.usuario_id as number);
      const rebaixados = await sql`
        UPDATE usuarios
        SET tipo_usuario = 'free'
        WHERE id = ANY(${ids})
          AND tipo_usuario = 'premium'
          AND NOT EXISTS (
            SELECT 1 FROM assinaturas a
            WHERE a.usuario_id = usuarios.id AND a.status = 'ativo'
          )
        RETURNING id
      `;
      premiumRebaixados = rebaixados.length;
    }

    console.log(
      `[fiscal-banco] Assinaturas expiradas: ${vencidas.length} | Premiums rebaixados: ${premiumRebaixados}`
    );

    return NextResponse.json({
      ok: true,
      processadas: vencidas.length,
      premiums_rebaixados: premiumRebaixados,
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
