import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";

// Rota de setup único — cria a tabela falhas_agentes se não existir
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  await sql`
    CREATE TABLE IF NOT EXISTS falhas_agentes (
      id SERIAL PRIMARY KEY,
      agente TEXT NOT NULL,
      erro TEXT NOT NULL,
      dados JSONB,
      resolvido BOOLEAN DEFAULT FALSE,
      tentativas INTEGER DEFAULT 1,
      criado_em TIMESTAMPTZ DEFAULT NOW(),
      resolvido_em TIMESTAMPTZ
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS idx_falhas_agente ON falhas_agentes (agente, resolvido, criado_em DESC)
  `;

  return NextResponse.json({ ok: true, mensagem: "Tabela falhas_agentes criada/confirmada" });
}
