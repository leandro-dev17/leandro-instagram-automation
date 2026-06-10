/**
 * PUSH DIÁRIO — Coleta dados para o enviador-push
 * Busca destinatários com assinatura ativa e retorna subscriptions.
 * O envio efetivo é feito pelo agente enviador-push (que usa web-push + VAPID).
 */
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "push-diario");
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
    // Busca usuários com assinatura ativa que aceitaram push notifications
    const destinatarios = await sql`
      SELECT u.id AS usuario_id, u.email, u.nome, pn.endpoint, pn.p256dh AS chave_p256dh, pn.auth AS chave_auth
      FROM usuarios u
      JOIN push_subscriptions pn ON pn.usuario_id = u.id
      LEFT JOIN assinaturas a ON a.usuario_id = u.id AND a.status = 'ativo'
      WHERE pn.ativo = true
        AND (a.id IS NOT NULL OR u.tipo_usuario IN ('premium', 'trial'))
      LIMIT 500
    `;

    // Busca receita do dia (mais recente)
    const [receitaDia] = await sql`
      SELECT id, titulo, descricao
      FROM receitas
      ORDER BY created_at DESC
      LIMIT 1
    `;

    console.log(
      `[push-diario] Destinatários: ${destinatarios.length} | Receita do dia: ${receitaDia?.titulo ?? "nenhuma"}`
    );

    return NextResponse.json({
      ok: true,
      destinatarios: destinatarios.length,
      receita_dia: receitaDia ?? null,
      subscriptions: destinatarios,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[push-diario] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no push diário", detalhe: mensagem },
      { status: 500 }
    );
  }
}
