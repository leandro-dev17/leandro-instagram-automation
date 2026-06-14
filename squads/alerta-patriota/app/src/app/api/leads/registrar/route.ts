import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Rate limiting básico por IP (best-effort, em memória — reseta por instância/deploy,
// mas já evita flood trivial nesta rota pública sem autenticação)
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
      email VARCHAR(255) NOT NULL UNIQUE,
      nome VARCHAR(255),
      plano_interesse VARCHAR(20),
      origem VARCHAR(50),
      convertido BOOLEAN DEFAULT false,
      ultimo_email_enviado INT DEFAULT 0,
      email_enviado_at TIMESTAMP,
      created_at TIMESTAMP DEFAULT NOW()
    )
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
      email: string;
      nome?: string;
      plano?: string;
      origem?: string;
    };

    const { email, nome, plano, origem } = body;

    if (!email?.trim()) {
      return NextResponse.json({ erro: "E-mail obrigatório" }, { status: 400 });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return NextResponse.json({ erro: "E-mail inválido" }, { status: 400 });
    }

    const planoValido = plano && ["vip", "elite"].includes(plano) ? plano : null;
    const origemValida = origem || "landing";

    await sql`
      INSERT INTO leads (email, nome, plano_interesse, origem)
      VALUES (
        ${email.toLowerCase().trim()},
        ${nome?.trim() || null},
        ${planoValido},
        ${origemValida}
      )
      ON CONFLICT (email) DO NOTHING
    `;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("leads/registrar error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
