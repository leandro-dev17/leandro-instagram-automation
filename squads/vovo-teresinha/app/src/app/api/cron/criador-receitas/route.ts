import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "criador-receitas");
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
    // Garante colunas de agendamento de publicação
    await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'publicada'`;
    await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS agendada_para TIMESTAMPTZ`;
    await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS publicada_em TIMESTAMPTZ`;
    await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL`;

    // Verifica receitas pendentes de publicação e publica as agendadas para hoje
    const agora = new Date().toISOString();

    const publicadas = await sql`
      UPDATE receitas
      SET status = 'publicada', publicada_em = ${agora}::timestamptz
      WHERE status = 'agendada'
        AND agendada_para <= ${agora}::timestamptz
      RETURNING id, titulo, usuario_id, agendada_para
    `;

    const [{ total_publicadas }] = await sql`
      SELECT COUNT(*)::int AS total_publicadas
      FROM receitas
      WHERE status = 'publicada'
    `;

    console.log(
      `[criador-receitas] Receitas publicadas agora: ${publicadas.length} | Total publicadas: ${total_publicadas}`
    );

    return NextResponse.json({
      ok: true,
      publicadas_agora: publicadas.length,
      total_publicadas,
      detalhes: publicadas,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[criador-receitas] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no criador de receitas", detalhe: mensagem },
      { status: 500 }
    );
  }
}
