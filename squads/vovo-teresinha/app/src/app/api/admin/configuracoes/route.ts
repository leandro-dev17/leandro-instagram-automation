import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const rows = await sql`SELECT chave, valor FROM app_configuracoes ORDER BY chave`;
    const config: Record<string, string> = {};
    for (const row of rows) {
      config[row.chave] = row.valor;
    }

    return NextResponse.json({ dados: config });
  } catch (err) {
    console.error("admin/configuracoes GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const body = await req.json();
    const { chave, valor } = body;

    if (!chave || valor === undefined) {
      return NextResponse.json({ erro: "chave e valor obrigatórios" }, { status: 400 });
    }

    await sql`
      INSERT INTO app_configuracoes (chave, valor, updated_at)
      VALUES (${chave}, ${String(valor)}, NOW())
      ON CONFLICT (chave) DO UPDATE SET valor = ${String(valor)}, updated_at = NOW()
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("admin/configuracoes PUT error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
