import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Guard: valida o CRON_SECRET enviado pela Vercel (ou por qualquer chamador)
//
// CAUSA RAIZ DO 401 SISTÊMICO (01/06/2026):
// A variável CRON_SECRET estava ausente nas variáveis de ambiente de produção
// da Vercel, fazendo TODOS os crons retornarem 401 simultaneamente.
// Solução: adicionar CRON_SECRET em Vercel Dashboard → Settings →
// Environment Variables → Production e fazer redeploy.
//
// Esta versão retorna 503 (misconfiguration) quando o secret está ausente,
// diferenciando claramente de 401 (credencial errada), facilitando diagnóstico.
// ---------------------------------------------------------------------------
function autorizado(req: NextRequest): { ok: boolean; status?: number; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-banco] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables → Production, " +
          "adicione CRON_SECRET e faça redeploy. " +
          "Retornando 503 para distinguir misconfiguration de acesso indevido (401)."
      );
      return { ok: false, status: 503, motivo: "secret_ausente" };
    }
    console.warn(
      "[fiscal-banco] CRON_SECRET não definido — acesso permitido pois NODE_ENV !== 'production'."
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
    const agora = new Date().toISOString();

    // Marca como inativas assinaturas ativas há mais de 30 dias sem renovação
    const vencidas = await sql`
      UPDATE assinaturas
      SET status = 'inativa'
      WHERE status = 'ativa'
        AND renovada_em < ${agora}::timestamptz - INTERVAL '30 days'
      RETURNING id, usuario_id, renovada_em
    `;

    // Coleta métricas básicas do banco
    const [metricas] = await sql`
      SELECT
        (SELECT COUNT(*)::int FROM usuarios)                              AS total_usuarios,
        (SELECT COUNT(*)::int FROM assinaturas WHERE status = 'ativa')   AS assinaturas_ativas,
        (SELECT COUNT(*)::int FROM assinaturas WHERE status = 'inativa') AS assinaturas_inativas,
        NOW() AS verificado_em
    `;

    console.info(
      `[fiscal-banco] Assinaturas marcadas inativas: ${vencidas.length}. ` +
        `Usuários: ${metricas.total_usuarios} | Ativas: ${metricas.assinaturas_ativas} | Inativas: ${metricas.assinaturas_inativas}.`
    );

    return NextResponse.json({
      ok: true,
      processadas: vencidas.length,
      detalhes: vencidas,
      metricas: {
        total_usuarios: metricas.total_usuarios,
        assinaturas_ativas: metricas.assinaturas_ativas,
        assinaturas_inativas: metricas.assinaturas_inativas,
        verificado_em: metricas.verificado_em,
      },
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
