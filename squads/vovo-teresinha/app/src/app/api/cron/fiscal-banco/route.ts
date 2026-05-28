import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Guard: valida o CRON_SECRET enviado pela Vercel (ou por qualquer chamador)
// A Vercel injeta automaticamente o header Authorization: Bearer <CRON_SECRET>
// quando o cron é disparado internamente.
// ---------------------------------------------------------------------------
function autorizado(req: NextRequest): boolean {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;

  if (!secret) {
    // Sem segredo configurado → bloqueia por segurança
    console.error("[fiscal-banco] CRON_SECRET não está definido nas variáveis de ambiente.");
    return false;
  }

  return authHeader === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!autorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // ------------------------------------------------------------------
    // Fiscal do banco: verifica assinaturas vencidas e marca como inativas
    // Usa a coluna correta `renovada_em` da tabela `assinaturas`
    // ------------------------------------------------------------------
    const agora = new Date().toISOString();

    const vencidas = await sql`
      UPDATE assinaturas
      SET status = 'inativa'
      WHERE status = 'ativa'
        AND renovada_em < ${agora}::timestamptz - INTERVAL '30 days'
      RETURNING id, usuario_id, renovada_em
    `;

    console.log(`[fiscal-banco] Assinaturas expiradas marcadas como inativas: ${vencidas.length}`);

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
