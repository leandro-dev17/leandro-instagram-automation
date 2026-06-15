import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

const LIMITE_POR_JANELA = 5;
const JANELA_MS = 60_000;
const requisicoesPorIp = new Map<string, number[]>();

function excedeuLimite(ip: string): boolean {
  const agora = Date.now();
  const historico = (requisicoesPorIp.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  historico.push(agora);
  requisicoesPorIp.set(ip, historico);
  return historico.length > LIMITE_POR_JANELA;
}

async function ensureLeadsTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS leads (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) UNIQUE,
      telefone VARCHAR(20),
      nome VARCHAR(255),
      plano_interesse VARCHAR(20),
      origem VARCHAR(50),
      convertido BOOLEAN DEFAULT false,
      ultimo_email_enviado INT DEFAULT 0,
      email_enviado_at TIMESTAMP,
      ultimo_whatsapp_enviado INT DEFAULT 0,
      whatsapp_enviado_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
  `.catch(() => null);

  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS telefone VARCHAR(20)`.catch(() => null);
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS ultimo_whatsapp_enviado INT DEFAULT 0`.catch(() => null);
  await sql`ALTER TABLE leads ADD COLUMN IF NOT EXISTS whatsapp_enviado_at TIMESTAMP`.catch(() => null);
  await sql`ALTER TABLE leads ALTER COLUMN email DROP NOT NULL`.catch(() => null);
  await sql`
    CREATE UNIQUE INDEX IF NOT EXISTS leads_telefone_unique
    ON leads(telefone) WHERE telefone IS NOT NULL
  `.catch(() => null);
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    if (excedeuLimite(ip)) {
      return NextResponse.json({ erro: "Muitas requisições, tente novamente em breve" }, { status: 429 });
    }

    await ensureLeadsTable();

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
