import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const rows = await sql`SELECT id, titulo, categoria, foto_url FROM receitas WHERE is_personal = false ORDER BY id ASC`;
  return NextResponse.json({ total: rows.length, receitas: rows });
}
