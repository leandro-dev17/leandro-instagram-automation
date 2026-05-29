import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const ops: string[] = [];

  // 1. Deletar duplicatas de "Molho de Tomate" — manter apenas ID 442 e 443
  await sql`DELETE FROM receitas WHERE id IN (444, 445, 446)`;
  ops.push("Deletadas 3 duplicatas de Molho de Tomate (IDs 444, 445, 446)");

  // 2. Adicionar imagem às 2 receitas de Molho de Tomate restantes
  const imgMolho = "https://www.themealdb.com/images/media/meals/stpuws1511191310.jpg";
  await sql`UPDATE receitas SET foto_url = ${imgMolho} WHERE id IN (442, 443) AND (foto_url IS NULL OR foto_url = '')`;
  ops.push("Adicionada imagem de molho de tomate para IDs 442 e 443");

  // 3. Corrigir categoria do "Pudins de Forno" (ID 447)
  await sql`UPDATE receitas SET categoria = 'doces_sobremesas' WHERE id = 447`;
  ops.push("Corrigida categoria ID 447 (Pudins de Forno): molhos_temperos → doces_sobremesas");

  // 4. Corrigir categoria do "Arroz à Síria com Carne Moída" (ID 452)
  await sql`UPDATE receitas SET categoria = 'pratos_principais' WHERE id = 452`;
  ops.push("Corrigida categoria ID 452 (Arroz à Síria com Carne Moída): sucos_vitaminas → pratos_principais");

  return NextResponse.json({ ok: true, operacoes: ops });
}
