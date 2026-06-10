import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/cron-auth";

export async function GET(req: NextRequest) {
  const auth = cronAutorizado(req, "fiscal-login");
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
    // Garante estrutura da tabela
    await sql`
      CREATE TABLE IF NOT EXISTS logs_login (
        id SERIAL PRIMARY KEY,
        email TEXT,
        ip TEXT,
        sucesso BOOLEAN NOT NULL,
        criada_em TIMESTAMPTZ DEFAULT NOW()
      )
    `;

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
