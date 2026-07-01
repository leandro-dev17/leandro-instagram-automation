import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.tipo_usuario !== "admin") {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
  }

  const resultados: string[] = [];

  try {
    // Verificar colunas existentes em usuarios
    const cols = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'usuarios' ORDER BY column_name
    `;
    resultados.push("Colunas atuais: " + cols.map((c: { column_name: string }) => c.column_name).join(", "));

    // Adicionar colunas faltantes em usuarios
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
    resultados.push("Colunas adicionadas em usuarios com IF NOT EXISTS");

    // Verificar colunas após migração em usuarios
    const colsAfter = await sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_name = 'usuarios' ORDER BY column_name
    `;
    resultados.push("Colunas após migração em usuarios: " + colsAfter.map((c: { column_name: string }) => c.column_name).join(", "));

    // Criar tabela whatsapp_fila se não existir e adicionar coluna numero
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_fila (
        id SERIAL PRIMARY KEY,
        numero TEXT NOT NULL,
        mensagem TEXT,
        criado_em TIMESTAMPTZ DEFAULT NOW(),
        enviado_em TIMESTAMPTZ,
        status TEXT DEFAULT 'pendente'
      )
    `;
    resultados.push("Tabela whatsapp_fila verificada/criada");

    // Adicionar coluna numero em whatsapp_fila se não existir
    await sql`
      ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS numero TEXT NOT NULL DEFAULT ''
    `;
    resultados.push("Coluna numero adicionada em whatsapp_fila");

    // Contar usuários
    const count = await sql`SELECT COUNT(*) as total FROM usuarios`;
    resultados.push(`Total de usuários: ${(count[0] as { total: number }).total}`);

    // Contar filas pendentes
    const filaCount = await sql`SELECT COUNT(*) as total FROM whatsapp_fila WHERE status = 'pendente'`;
    resultados.push(`Mensagens WhatsApp pendentes: ${(filaCount[0] as { total: number }).total}`);

    return NextResponse.json({ ok: true, resultados });
  } catch (err) {
    console.error("setup error", err);
    return NextResponse.json({ erro: String(err), resultados }, { status: 500 });
  }
}