/**
 * TRIAL EXPIRANDO — Detector de Trials Expirando
 * CORRIGIDO: usa usuarios.trial_fim (e não assinaturas.status='trial' que é incorreto).
 * Busca usuários com trial_fim nas próximas 48h e envia lista para o notificador-trial tratar.
 */
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "trial-expirando");
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
    const agora = new Date();
    const em48h = new Date(agora.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const agoraIso = agora.toISOString();

    // Query correta: usa usuarios.trial_fim — é aqui onde o sistema de trial é controlado
    const expirando = await sql`
      SELECT id, email, nome, trial_fim
      FROM usuarios
      WHERE tipo_usuario = 'trial'
        AND trial_fim BETWEEN ${agoraIso}::timestamptz AND ${em48h}::timestamptz
      ORDER BY trial_fim ASC
    `;

    // Também detecta trials já vencidos que não foram atualizados (limpeza)
    const expirados = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
      WHERE tipo_usuario = 'trial' AND trial_fim < NOW()
    `;

    console.log(`[trial-expirando] Expirando em 48h: ${expirando.length} | Já expirados: ${expirados[0].total}`);

    return NextResponse.json({
      ok: true,
      expirando_em_48h: expirando.length,
      ja_expirados_sem_update: Number(expirados[0].total),
      detalhes: expirando,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[trial-expirando] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no trial-expirando", detalhe: mensagem },
      { status: 500 }
    );
  }
}
