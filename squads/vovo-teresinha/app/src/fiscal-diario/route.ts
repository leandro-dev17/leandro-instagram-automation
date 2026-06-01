import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Guard: valida o CRON_SECRET enviado pela Vercel
// Retorna 503 quando CRON_SECRET está ausente em produção (misconfiguration),
// diferenciando de 401 (credencial inválida).
// ---------------------------------------------------------------------------
function autorizado(req: NextRequest): { ok: boolean; status?: number; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-diario] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables → Production, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, status: 503, motivo: "secret_ausente" };
    }
    console.warn("[fiscal-diario] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-diario] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        "(esperado: \"Bearer ***\")."
    );
    return { ok: false, status: 401, motivo: "header_invalido" };
  }

  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = autorizado(req);
  if (!auth.ok) {
    const httpStatus = auth.status ?? 401;
    const isSecretAusente = auth.motivo === "secret_ausente";
    return NextResponse.json(
      {
        erro: isSecretAusente ? "Serviço mal configurado" : "Não autorizado",
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: httpStatus }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    const agora = new Date();
    const ontem = new Date(agora.getTime() - 24 * 60 * 60 * 1000).toISOString();

    const [{ total_usuarios }] = await sql`
      SELECT COUNT(*)::int AS total_usuarios FROM usuarios
    `;

    const [{ total_assinaturas_ativas }] = await sql`
      SELECT COUNT(*)::int AS total_assinaturas_ativas
      FROM assinaturas
      WHERE status = 'ativa'
    `;

    const [{ receitas_24h }] = await sql`
      SELECT COUNT(*)::int AS receitas_24h
      FROM receitas
      WHERE criada_em >= ${ontem}::timestamptz
    `;

    console.info(
      `[fiscal-diario] usuarios=${total_usuarios} assinaturas_ativas=${total_assinaturas_ativas} receitas_24h=${receitas_24h}`
    );

    return NextResponse.json({
      ok: true,
      total_usuarios,
      total_assinaturas_ativas,
      receitas_24h,
      gerado_em: agora.toISOString(),
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-diario] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no fiscal diário", detalhe: mensagem },
      { status: 500 }
    );
  }
}
