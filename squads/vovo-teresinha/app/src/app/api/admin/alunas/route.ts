import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, hashPassword } from "@/lib/auth";
import { enviarEmailBoasVindasAluna } from "@/lib/brevo";
import { enfileirarMensagem } from "@/lib/whatsapp";

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS alunas_leandro (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      nome TEXT,
      sexo TEXT DEFAULT 'F',
      ativo BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      last_access_at TIMESTAMPTZ
    )
  `;
  await sql`ALTER TABLE alunas_leandro ADD COLUMN IF NOT EXISTS last_access_at TIMESTAMPTZ`;
  await sql`ALTER TABLE alunas_leandro ADD COLUMN IF NOT EXISTS sexo TEXT DEFAULT 'F'`;
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    await ensureTable();

    const rows = await sql`
      SELECT al.id, al.email, al.nome, al.sexo, al.ativo, al.created_at, al.last_access_at,
             u.id as usuario_id, u.tipo_usuario,
             COUNT(f.id)::int as total_favoritos
      FROM alunas_leandro al
      LEFT JOIN usuarios u ON u.email = al.email
      LEFT JOIN favoritos f ON f.usuario_id = u.id
      GROUP BY al.id, al.email, al.nome, al.sexo, al.ativo, al.created_at, al.last_access_at, u.id, u.tipo_usuario
      ORDER BY al.created_at DESC
    `;

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("admin/alunas GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { email, nome, senha, sexo } = await req.json();
    if (!email) return NextResponse.json({ erro: "Email obrigatório" }, { status: 400 });
    if (!senha || senha.length < 6) return NextResponse.json({ erro: "Senha temporária deve ter ao menos 6 caracteres" }, { status: 400 });

    const emailNorm = email.toLowerCase().trim();
    const sexoNorm = sexo === "M" ? "M" : "F";

    await ensureTable();

    // Inserir ou reativar na tabela de alunas
    const result = await sql`
      INSERT INTO alunas_leandro (email, nome, sexo, ativo)
      VALUES (${emailNorm}, ${nome || null}, ${sexoNorm}, true)
      ON CONFLICT (email) DO UPDATE SET ativo = true, sexo = ${sexoNorm}, nome = COALESCE(${nome || null}, alunas_leandro.nome)
      RETURNING id, email, nome, sexo, ativo
    `;

    // Verificar se já tem conta de usuário
    const existente = await sql`SELECT id FROM usuarios WHERE email = ${emailNorm} LIMIT 1`;

    if (existente.length > 0) {
      // Já tem conta — apenas promove para aluna_leandro e atualiza senha
      const senha_hash = await hashPassword(senha);
      await sql`
        UPDATE usuarios SET tipo_usuario = 'aluna_leandro', senha_hash = ${senha_hash},
          nome = COALESCE(${nome || null}, nome)
        WHERE email = ${emailNorm}
      `;
    } else {
      // Não tem conta — cria conta completa com senha temporária
      const senha_hash = await hashPassword(senha);
      await sql`
        INSERT INTO usuarios (nome, email, senha_hash, tipo_usuario, aceita_whatsapp)
        VALUES (${nome || emailNorm}, ${emailNorm}, ${senha_hash}, 'aluna_leandro', false)
      `;
    }

    await enviarEmailBoasVindasAluna(emailNorm, nome || emailNorm, sexoNorm).catch(() => {});

    // Enfileira WhatsApp de boas-vindas (só envia se aluna tiver whatsapp + aceita_whatsapp)
    const alunaUser = await sql`SELECT id FROM usuarios WHERE email = ${emailNorm} LIMIT 1`;
    if (alunaUser.length > 0) {
      enfileirarMensagem(alunaUser[0].id, "boas_vindas_aluna").catch(() => {});
    }

    return NextResponse.json({ dados: result[0] }, { status: 201 });
  } catch (err) {
    console.error("admin/alunas POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
