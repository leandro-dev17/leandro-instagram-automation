import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[agente-assinaturas] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    console.warn("[agente-assinaturas] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[agente-assinaturas] Header Authorization inválido. " +
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
    const agora = new Date().toISOString();

    // Expira assinaturas trial vencidas
    const trialsExpirados = await sql`
      UPDATE assinaturas
      SET status = 'expirada'
      WHERE status = 'trial'
        AND renovada_em < ${agora}::timestamptz
      RETURNING id, usuario_id, renovada_em
    `;

    // Expira assinaturas ativas sem renovação há mais de 30 dias
    const ativasExpiradas = await sql`
      UPDATE assinaturas
      SET status = 'expirada'
      WHERE status = 'ativa'
        AND renovada_em < ${agora}::timestamptz - INTERVAL '30 days'
      RETURNING id, usuario_id, renovada_em
    `;

    console.log(
      `[agente-assinaturas] Trials expirados: ${trialsExpirados.length} | Ativas expiradas: ${ativasExpiradas.length}`
    );

    return NextResponse.json({
      ok: true,
      trials_expirados: trialsExpirados.length,
      ativas_expiradas: ativasExpiradas.length,
      detalhes_trials: trialsExpirados,
      detalhes_ativas: ativasExpiradas,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[agente-assinaturas] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no agente de assinaturas", detalhe: mensagem },
      { status: 500 }
    );
  }
}
