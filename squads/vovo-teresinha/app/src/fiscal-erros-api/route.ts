import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

// ---------------------------------------------------------------------------
// Guard: valida o CRON_SECRET enviado pela Vercel (ou por qualquer chamador)
//
// CORREÇÃO (28/05/2026): secret ausente em produção retorna 503 (configuração
// ausente) em vez de 401 (não autorizado), evitando falso-positivo de segurança
// e tornando o diagnóstico imediato via status HTTP.
// ---------------------------------------------------------------------------
function autorizado(req: NextRequest): { ok: boolean; status?: number; motivo?: string } {
  const authHeader = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-erros-api] CRON_SECRET não está definido nas variáveis de ambiente do projeto " +
          "(Vercel Dashboard → Settings → Environment Variables). " +
          "O cron ficará bloqueado até que a variável seja adicionada e o projeto seja reimplantado. " +
          "Retornando 503 para distinguir misconfiguration de acesso indevido (401)."
      );
      return { ok: false, status: 503, motivo: "secret_ausente" };
    }
    console.warn(
      "[fiscal-erros-api] CRON_SECRET não definido — acesso permitido pois NODE_ENV !== 'production'. " +
        "Configure a variável para testar o fluxo completo de autenticação."
    );
    return { ok: true };
  }

  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-erros-api] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        `(esperado: "Bearer ***"). ` +
        "Verifique se CRON_SECRET no ambiente corresponde ao valor configurado no cron job."
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
    // ------------------------------------------------------------------
    // Fiscal de erros de API: agrega e consolida erros recentes registrados
    // ------------------------------------------------------------------

    // 1. Erros das últimas 24h agrupados por endpoint e status
    const erros24h = await sql`
      SELECT
        endpoint,
        status_code,
        COUNT(*)         AS total,
        MAX(criado_em)   AS ultimo_ocorrido
      FROM erros_api
      WHERE criado_em >= NOW() - INTERVAL '24 hours'
      GROUP BY endpoint, status_code
      ORDER BY total DESC
      LIMIT 50
    `;

    // 2. Total geral de erros nas últimas 24h
    const [resumo] = await sql`
      SELECT
        COUNT(*)                                          AS total_erros_24h,
        COUNT(*) FILTER (WHERE status_code >= 500)       AS erros_5xx,
        COUNT(*) FILTER (WHERE status_code BETWEEN 400 AND 499) AS erros_4xx,
        NOW()                                            AS verificado_em
      FROM erros_api
      WHERE criado_em >= NOW() - INTERVAL '24 hours'
    `;

    console.info(
      `[fiscal-erros-api] Verificação concluída. ` +
        `Total erros 24h: ${resumo.total_erros_24h} ` +
        `(5xx: ${resumo.erros_5xx} | 4xx: ${resumo.erros_4xx}).`
    );

    return NextResponse.json(
      {
        ok: true,
        resumo: {
          total_erros_24h: resumo.total_erros_24h,
          erros_5xx: resumo.erros_5xx,
          erros_4xx: resumo.erros_4xx,
          verificado_em: resumo.verificado_em,
        },
        erros_por_endpoint: erros24h,
      },
      { status: 200 }
    );
  } catch (err) {
    console.error("[fiscal-erros-api] Erro ao consultar erros de API:", err);
    return NextResponse.json(
      { erro: "Erro interno ao verificar erros de API" },
      { status: 500 }
    );
  }
}
