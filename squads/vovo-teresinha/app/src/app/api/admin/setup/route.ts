import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Rota de setup/migração protegida por chave secreta via query param
// Uso: GET /api/admin/setup?key=JWT_SECRET_VALUE
export async function GET(req: NextRequest) {
  const key = req.nextUrl.searchParams.get("key");
  if (!key || key !== process.env.JWT_SECRET) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
  }

  const resultados: string[] = [];

  try {
    // Verificar colunas existentes em usuarios
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'usuarios' ORDER BY column_name
    `;
    resultados.push("Colunas atuais: " + cols.map((c) => c.column_name).join(", "));

    // Adicionar colunas faltantes
    const migrations = [
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS whatsapp TEXT`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aceita_whatsapp BOOLEAN DEFAULT false`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plano TEXT`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_inicio TIMESTAMPTZ`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_fim TIMESTAMPTZ`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS assinatura_id TEXT`,
      sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`,
    ];

    for (const migration of migrations) {
      await migration;
    }
    resultados.push("Colunas adicionadas com IF NOT EXISTS");

    // Verificar colunas após migração
    const colsAfter = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'usuarios' ORDER BY column_name
    `;
    resultados.push("Colunas após migração: " + colsAfter.map((c) => c.column_name).join(", "));

    // Contar usuários
    const count = await sql`SELECT COUNT(*) as total FROM usuarios`;
    resultados.push(`Total de usuários: ${count[0].total}`);

    return NextResponse.json({ ok: true, resultados });
  } catch (err) {
    console.error("setup error", err);
    return NextResponse.json({ erro: String(err), resultados }, { status: 500 });
  }
}
