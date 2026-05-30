import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Guard: valida o CRON_SECRET enviado pela Vercel (ou por qualquer chamador)
// A Vercel injeta automaticamente o header Authorization: Bearer <CRON_SECRET>
// quando o cron é disparado internamente.
//
// ATENÇÃO: se CRON_SECRET não estiver definido nas variáveis de ambiente do
// projeto Vercel (Dashboard → Settings → Environment Variables → Production),
// TODOS os crons retornarão 401. Adicione a variável e faça redeploy.
// ---------------------------------------------------------------------------
function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-banco] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    console.warn(
      "[fiscal-banco] CRON_SECRET não definido — acesso permitido fora de produção."
    );
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-banco] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        `(esperado: "Bearer ***"). ` +
        "Verifique se CRON_SECRET no ambiente corresponde ao valor configurado."
    );
    return { ok: false, motivo: "header_invalido" };
  }

  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = autorizado(req);
  if (!auth.ok) {
    return NextResponse.json(
      {
        erro: "Não autorizado",
        diagnostico: auth.motivo,
        instrucao:
          auth.motivo === "secret_ausente"
            ? "Adicione a variável CRON_SECRET em Vercel Dashboard → Settings → Environment Variables → Production e faça redeploy."
            : "Verifique se o valor de CRON_SECRET no ambiente Vercel está correto e corresponde ao header Authorization enviado.",
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
      { erro: "Erro interno no fiscal do banco", detalhe: mensagem },
      { status: 500 }
    );
  }
}
