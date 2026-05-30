import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[trial-expirando] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    console.warn("[trial-expirando] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[trial-expirando] Header Authorization inválido. " +
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
    // Busca assinaturas trial que expiram nas próximas 48h para notificação
    const agora = new Date();
    const em48h = new Date(agora.getTime() + 48 * 60 * 60 * 1000).toISOString();
    const agoraIso = agora.toISOString();

    const expirando = await sql`
      SELECT a.id, a.usuario_id, a.renovada_em,
             u.email, u.nome
      FROM assinaturas a
      JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.status = 'trial'
        AND a.renovada_em BETWEEN ${agoraIso}::timestamptz AND ${em48h}::timestamptz
      ORDER BY a.renovada_em ASC
    `;

    console.log(`[trial-expirando] Trials expirando em 48h: ${expirando.length}`);

    return NextResponse.json({
      ok: true,
      expirando_em_48h: expirando.length,
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
