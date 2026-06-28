import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

const LIMITE_POR_JANELA = 5;

// Item 26 (Fase 30): o rate limit anterior usava um Map em memória do processo —
// ineficaz em serverless, onde cada cold start (e cada instância concorrente sob
// carga) tem memória isolada, então o limite nunca era de fato global por IP.
// Persistido em leads_rate_limit (tabela criada em admin/setup/route.ts), válido
// entre instâncias/invocações. Limpeza oportunista evita crescimento indefinido
// sem precisar de um cron dedicado só para isso.
async function excedeuLimite(ip: string): Promise<boolean> {
  const rows = await sql`
    SELECT COUNT(*)::int AS total FROM leads_rate_limit
    WHERE ip = ${ip} AND created_at > NOW() - INTERVAL '60 seconds'
  `;
  await sql`INSERT INTO leads_rate_limit (ip) VALUES (${ip})`;
  await sql`DELETE FROM leads_rate_limit WHERE created_at < NOW() - INTERVAL '10 minutes'`.catch(() => {});
  return (rows[0]?.total ?? 0) >= LIMITE_POR_JANELA;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    if (await excedeuLimite(ip)) {
      return NextResponse.json({ erro: "Muitas requisições, tente novamente em breve" }, { status: 429 });
    }

    const body = await req.json() as {
      email?: string;
      telefone?: string;
      nome?: string;
      plano?: string;
      origem?: string;
    };

    const { email, telefone, nome, plano, origem } = body;

    if (!email?.trim() && !telefone?.trim()) {
      return NextResponse.json({ erro: "E-mail ou WhatsApp obrigatório" }, { status: 400 });
    }

    if (email?.trim()) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return NextResponse.json({ erro: "E-mail inválido" }, { status: 400 });
      }
    }

    if (telefone?.trim()) {
      const fone = telefone.replace(/\D/g, "");
      if (fone.length < 10 || fone.length > 13) {
        return NextResponse.json({ erro: "WhatsApp inválido — informe com DDD" }, { status: 400 });
      }
    }

    const planoValido = plano && ["vip", "elite"].includes(plano) ? plano : null;
    const origemValida = origem || "landing";
    const emailNorm = email?.toLowerCase().trim() || null;
    const foneNorm = telefone?.replace(/\D/g, "") || null;

    if (emailNorm) {
      await sql`
        INSERT INTO leads (email, telefone, nome, plano_interesse, origem)
        VALUES (${emailNorm}, ${foneNorm}, ${nome?.trim() || null}, ${planoValido}, ${origemValida})
        ON CONFLICT (email) DO UPDATE SET
          telefone = COALESCE(EXCLUDED.telefone, leads.telefone),
          nome = COALESCE(EXCLUDED.nome, leads.nome)
      `;
    } else {
      await sql`
        INSERT INTO leads (telefone, nome, plano_interesse, origem)
        VALUES (${foneNorm}, ${nome?.trim() || null}, ${planoValido}, ${origemValida})
        ON CONFLICT (telefone) WHERE telefone IS NOT NULL DO NOTHING
      `;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("leads/registrar error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
