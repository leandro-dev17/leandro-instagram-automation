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
    // 1. Expira assinaturas ativas sem renovação além do prazo esperado do plano (+15 dias de margem)
    // (PreApproval cancelado silenciosamente pelo MP sem webhook, por exemplo)
    const ativasExpiradas = await sql`
      UPDATE assinaturas
      SET status = 'expirada'
      WHERE status = 'ativo'
        AND renovada_em IS NOT NULL
        AND renovada_em < NOW() - INTERVAL '45 days'
      RETURNING id, usuario_id, renovada_em
    `;

    // 2. Rebaixa usuários premium cujas assinaturas acabaram de expirar (passo 1)
    //    sem ter outra assinatura ativa
    let premiumRebaixados = 0;
    if (ativasExpiradas.length > 0) {
      const ids = ativasExpiradas.map((r) => r.usuario_id as number);
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
      `[agente-assinaturas] Assinaturas expiradas: ${ativasExpiradas.length} | ` +
      `Premiums rebaixados: ${premiumRebaixados}`
    );

    return NextResponse.json({
      ok: true,
      assinaturas_expiradas: ativasExpiradas.length,
      premiums_rebaixados: premiumRebaixados,
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
