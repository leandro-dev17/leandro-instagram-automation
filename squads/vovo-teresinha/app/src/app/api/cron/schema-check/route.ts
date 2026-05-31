import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const [favoritos, receitas, usuarios, assinaturas, push_sub] = await Promise.all([
    sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'favoritos' ORDER BY ordinal_position`,
    sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'receitas' ORDER BY ordinal_position`,
    sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'usuarios' ORDER BY ordinal_position`,
    sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'assinaturas' ORDER BY ordinal_position`,
    sql`SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'push_subscriptions' ORDER BY ordinal_position`,
  ]);

  // Testar INSERT/SELECT em favoritos para pegar o erro real
  let favoritosError = null;
  try {
    await sql`SELECT f.id, f.created_at FROM favoritos f LIMIT 1`;
  } catch (e: any) {
    favoritosError = e.message;
  }

  return NextResponse.json({
    favoritos: favoritos.map((r: any) => r.column_name),
    receitas_cols: receitas.map((r: any) => r.column_name),
    usuarios_cols: usuarios.map((r: any) => r.column_name),
    assinaturas_cols: assinaturas.map((r: any) => r.column_name),
    push_sub_cols: push_sub.map((r: any) => r.column_name),
    favoritos_created_at_error: favoritosError,
  });
}
