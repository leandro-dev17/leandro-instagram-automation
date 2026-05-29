import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { verificarCronAuth, respostaNaoAutorizado } from "@/lib/cron-guard";

export async function GET(req: NextRequest) {
  const auth = verificarCronAuth(req, "fiscal-banco");
  if (!auth.ok) return respostaNaoAutorizado(auth.motivo);

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // ------------------------------------------------------------------
    // Fiscal do banco: verifica assinaturas vencidas e marca como inativas
    // Coluna correta: `renovada_em` (não updated_at nem created_at)
    // ------------------------------------------------------------------
    const agora = new Date().toISOString();

    const vencidas = await sql`
      UPDATE assinaturas
      SET status = 'inativa'
      WHERE status = 'ativa'
        AND renovada_em < ${agora}::timestamptz - INTERVAL '30 days'
      RETURNING id, usuario_id, renovada_em
    `;

    console.log(
      `[fiscal-banco] ✅ Assinaturas expiradas marcadas como inativas: ${vencidas.length}`
    );

    return NextResponse.json({
      ok: true,
      processadas: vencidas.length,
      detalhes: vencidas,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-banco] ❌ Erro ao executar fiscal do banco:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno ao processar fiscal do banco", detalhe: mensagem },
      { status: 500 }
    );
  }
}
