import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-pagamentos] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    console.warn("[fiscal-pagamentos] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-pagamentos] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        "(esperado: \"Bearer ***\")."
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
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Verifica pagamentos pendentes há mais de 24h e pagamentos recentes com falha
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const pendentes = await sql`
      SELECT id, usuario_id, valor, criada_em
      FROM pagamentos
      WHERE status = 'pendente'
        AND criada_em < ${ontem}::timestamptz
      ORDER BY criada_em ASC
      LIMIT 100
    `;

    const falhas = await sql`
      SELECT id, usuario_id, valor, criada_em, motivo_falha
      FROM pagamentos
      WHERE status = 'falha'
        AND criada_em >= ${ontem}::timestamptz
      ORDER BY criada_em DESC
      LIMIT 50
    `;

    console.log(
      `[fiscal-pagamentos] Pendentes >24h: ${pendentes.length} | Falhas 24h: ${falhas.length}`
    );

    return NextResponse.json({
      ok: true,
      pendentes_antigos: pendentes.length,
      falhas_recentes: falhas.length,
      detalhes_pendentes: pendentes,
      detalhes_falhas: falhas,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-pagamentos] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no fiscal de pagamentos", detalhe: mensagem },
      { status: 500 }
    );
  }
}
