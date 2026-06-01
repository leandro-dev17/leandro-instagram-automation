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
        "[fiscal-login] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables → Production, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, status: 503, motivo: "secret_ausente" };
    }
    console.warn("[fiscal-login] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[fiscal-login] Header Authorization inválido. " +
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
    const ontem = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const suspeitos = await sql`
      SELECT ip, COUNT(*)::int AS tentativas, MAX(criada_em) AS ultima_tentativa
      FROM logs_login
      WHERE sucesso = false
        AND criada_em >= ${ontem}::timestamptz
      GROUP BY ip
      HAVING COUNT(*) >= 5
      ORDER BY tentativas DESC
      LIMIT 50
    `;

    const [{ logins_ok }] = await sql`
      SELECT COUNT(*)::int AS logins_ok
      FROM logs_login
      WHERE sucesso = true
        AND criada_em >= ${ontem}::timestamptz
    `;

    console.info(
      `[fiscal-login] IPs suspeitos: ${suspeitos.length} | Logins bem-sucedidos 24h: ${logins_ok}`
    );

    return NextResponse.json({
      ok: true,
      periodo: "24h",
      ips_suspeitos: suspeitos.length,
      logins_sucesso_24h: logins_ok,
      detalhes_suspeitos: suspeitos,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[fiscal-login] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no fiscal de login", detalhe: mensagem },
      { status: 500 }
    );
  }
}
