import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";

function gerarCodigo(nome: string): string {
  const base = nome
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .slice(0, 8);
  const sufixo = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `${base}${sufixo}`;
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { nome, email, telefone, usuario_id } = body;

    if (!nome || !email) {
      return NextResponse.json({ erro: "nome e email são obrigatórios" }, { status: 400 });
    }

    // Verifica se já é afiliado
    const [existente] = await sql`
      SELECT id, codigo_afiliado FROM afiliados WHERE email = ${email}
    `;
    if (existente) {
      return NextResponse.json({
        ok: true,
        msg: "Já cadastrado",
        codigo_afiliado: existente.codigo_afiliado,
      });
    }

    const codigo = gerarCodigo(nome);

    const [novo] = await sql`
      INSERT INTO afiliados (nome, email, telefone, usuario_id, codigo_afiliado)
      VALUES (${nome}, ${email}, ${telefone || null}, ${usuario_id || null}, ${codigo})
      RETURNING id, codigo_afiliado
    `;

    await enviarTelegram(
      `🤝 <b>Novo afiliado cadastrado!</b>\n\n` +
      `Nome: ${nome}\n` +
      `Email: ${email}\n` +
      `Código: <code>${codigo}</code>`
    );

    return NextResponse.json({
      ok: true,
      id: novo.id,
      codigo_afiliado: novo.codigo_afiliado,
      link: `${process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app"}?ref=${codigo}`,
    });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
