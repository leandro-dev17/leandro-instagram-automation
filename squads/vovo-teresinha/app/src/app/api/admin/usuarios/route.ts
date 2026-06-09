import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const busca = searchParams.get("busca");
    const tipo = searchParams.get("tipo");
    const pagina = parseInt(searchParams.get("pagina") || "1");
    const limite = 30;
    const offset = (pagina - 1) * limite;

    let rows;

    if (busca && tipo) {
      rows = await sql`
        SELECT id, nome, email, whatsapp, tipo_usuario, plano, trial_fim
        FROM usuarios
        WHERE (nome ILIKE ${'%' + busca + '%'} OR email ILIKE ${'%' + busca + '%'})
          AND tipo_usuario = ${tipo}
        ORDER BY id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else if (busca) {
      rows = await sql`
        SELECT id, nome, email, whatsapp, tipo_usuario, plano, trial_fim
        FROM usuarios
        WHERE nome ILIKE ${'%' + busca + '%'} OR email ILIKE ${'%' + busca + '%'}
        ORDER BY id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else if (tipo) {
      rows = await sql`
        SELECT id, nome, email, whatsapp, tipo_usuario, plano, trial_fim
        FROM usuarios WHERE tipo_usuario = ${tipo}
        ORDER BY id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT id, nome, email, whatsapp, tipo_usuario, plano, trial_fim
        FROM usuarios ORDER BY id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    }

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("admin/usuarios GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
