import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const rows = await sql`SELECT * FROM usuarios WHERE id = ${session.id} LIMIT 1`;

    if (rows.length === 0) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

    const u = rows[0];
    return NextResponse.json({
      dados: {
        id: u.id,
        nome: u.nome ?? "",
        email: u.email ?? "",
        whatsapp: u.whatsapp ?? null,
        aceita_whatsapp: u.aceita_whatsapp ?? false,
        tipo_usuario: u.tipo_usuario ?? "free",
        plano: u.plano ?? null,
        trial_inicio: u.trial_inicio ?? u.criada_em ?? null,
        trial_fim: u.trial_fim ?? null,
        created_at: u.created_at ?? u.criada_em ?? null,
      },
    });
  } catch (err) {
    console.error("perfil GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { nome, whatsapp, aceita_whatsapp } = await req.json();

    await sql`
      UPDATE usuarios
      SET nome = COALESCE(${nome || null}, nome),
          whatsapp = COALESCE(${whatsapp || null}, whatsapp),
          aceita_whatsapp = COALESCE(${aceita_whatsapp !== undefined ? aceita_whatsapp : null}, aceita_whatsapp)
      WHERE id = ${session.id}
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("perfil PUT error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { objetivo, restricoes_alimentares, refeicoes_por_dia, onboarding_concluido } = await req.json();

    await sql`
      UPDATE usuarios
      SET objetivo = COALESCE(${objetivo || null}, objetivo),
          restricoes_alimentares = COALESCE(${restricoes_alimentares || null}, restricoes_alimentares),
          refeicoes_por_dia = COALESCE(${refeicoes_por_dia || null}, refeicoes_por_dia),
          onboarding_concluido = COALESCE(${onboarding_concluido !== undefined ? onboarding_concluido : null}, onboarding_concluido)
      WHERE id = ${session.id}
    `;

    return NextResponse.json({ dados: { ok: true } });
  } catch (err) {
    console.error("perfil PATCH error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
