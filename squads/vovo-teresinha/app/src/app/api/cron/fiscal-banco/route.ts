import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Guard: valida o CRON_SECRET enviado pela Vercel (ou por qualquer chamador)
// A Vercel injeta automaticamente o header Authorization: Bearer <CRON_SECRET>
// quando o cron é disparado internamente.
//
// Fluxo de validação:
//  1. Em produção (NODE_ENV === "production"): CRON_SECRET obrigatório.
//     - Ausente → 401 + log de erro claro.
//     - Presente mas header não bate → 401 + log de warning.
//  2. Fora de produção (dev/preview): se CRON_SECRET não estiver definido,
//     permite a chamada (facilita testes locais sem variável configurada).
//     Se CRON_SECRET estiver definido mesmo em dev, a validação é aplicada.
// ---------------------------------------------------------------------------
function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      // Produção sem CRON_SECRET configurado → bloqueia e avisa claramente
      console.error(
        "[fiscal-banco] CRON_SECRET não está definido nas variáveis de ambiente do projeto " +
          "(Vercel Dashboard → Settings → Environment Variables). " +
          "O cron ficará bloqueado até que a variável seja adicionada e o projeto seja reimplantado."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    // Fora de produção sem secret → permite (ambiente de dev/preview sem configuração local)
    console.warn(
      "[fiscal-banco] CRON_SECRET não definido — acesso permitido pois NODE_ENV !== 'production'. " +
        "Configure a variável para testar o fluxo completo de autenticação."
    );
    return { ok: true };
  }

  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-banco] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        `(esperado: "Bearer ***"). ` +
        "Verifique se CRON_SECRET no ambiente corresponde ao valor configurado no cron job."
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
        // Não expõe o motivo no body em produção para não vazar informação,
        // mas o motivo está nos logs do Vercel para diagnóstico.
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
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
