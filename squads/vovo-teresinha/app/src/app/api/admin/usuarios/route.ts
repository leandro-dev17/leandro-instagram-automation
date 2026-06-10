import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS last_login TIMESTAMPTZ`;

    const { searchParams } = new URL(req.url);
    const busca = searchParams.get("busca");
    const tipo = searchParams.get("tipo");
    const pagina = parseInt(searchParams.get("pagina") || "1");
    const limite = 30;
    const offset = (pagina - 1) * limite;

    let rows;

    if (busca && tipo) {
      rows = await sql`
        SELECT u.id, u.nome, u.email, u.whatsapp, u.tipo_usuario, u.plano, u.trial_fim, u.last_login,
               COALESCE(f.total, 0)::int AS favoritos_count
        FROM usuarios u
        LEFT JOIN (SELECT usuario_id, COUNT(*) AS total FROM favoritos GROUP BY usuario_id) f
          ON f.usuario_id = u.id
        WHERE (u.nome ILIKE ${'%' + busca + '%'} OR u.email ILIKE ${'%' + busca + '%'})
          AND u.tipo_usuario = ${tipo}
        ORDER BY u.id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else if (busca) {
      rows = await sql`
        SELECT u.id, u.nome, u.email, u.whatsapp, u.tipo_usuario, u.plano, u.trial_fim, u.last_login,
               COALESCE(f.total, 0)::int AS favoritos_count
        FROM usuarios u
        LEFT JOIN (SELECT usuario_id, COUNT(*) AS total FROM favoritos GROUP BY usuario_id) f
          ON f.usuario_id = u.id
        WHERE u.nome ILIKE ${'%' + busca + '%'} OR u.email ILIKE ${'%' + busca + '%'}
        ORDER BY u.id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else if (tipo) {
      rows = await sql`
        SELECT u.id, u.nome, u.email, u.whatsapp, u.tipo_usuario, u.plano, u.trial_fim, u.last_login,
               COALESCE(f.total, 0)::int AS favoritos_count
        FROM usuarios u
        LEFT JOIN (SELECT usuario_id, COUNT(*) AS total FROM favoritos GROUP BY usuario_id) f
          ON f.usuario_id = u.id
        WHERE u.tipo_usuario = ${tipo}
        ORDER BY u.id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    } else {
      rows = await sql`
        SELECT u.id, u.nome, u.email, u.whatsapp, u.tipo_usuario, u.plano, u.trial_fim, u.last_login,
               COALESCE(f.total, 0)::int AS favoritos_count
        FROM usuarios u
        LEFT JOIN (SELECT usuario_id, COUNT(*) AS total FROM favoritos GROUP BY usuario_id) f
          ON f.usuario_id = u.id
        ORDER BY u.id DESC LIMIT ${limite} OFFSET ${offset}
      `;
    }

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("admin/usuarios GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
