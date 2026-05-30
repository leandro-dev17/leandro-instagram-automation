import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[fiscal-login] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
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
    // Detecta tentativas de login suspeitas nas últimas 24h (>= 5 falhas por IP)
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

    console.log(
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
