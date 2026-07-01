import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { hashPassword, signToken, cookieOptions } from "@/lib/auth";
import { criarCheckoutMP } from "@/lib/mercadopago";
import { PLANOS } from "@/lib/planos";

export async function POST(req: NextRequest) {
  try {
    const { nome, email, senha, whatsapp, aceita_whatsapp, plano, ref } = await req.json();

    if (!nome || !email || !senha) {
      return NextResponse.json({ erro: "Nome, email e senha são obrigatórios" }, { status: 400 });
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ erro: "Email inválido" }, { status: 400 });
    }

    if (senha.length < 8) {
      return NextResponse.json({ erro: "Senha deve ter ao menos 8 caracteres" }, { status: 400 });
    }

    if (!whatsapp) {
      return NextResponse.json({ erro: "WhatsApp é obrigatório" }, { status: 400 });
    }

    if (!plano || !PLANOS[plano as keyof typeof PLANOS]) {
      return NextResponse.json({ erro: "Selecione um plano: Caderninho ou Livro de Receitas" }, { status: 400 });
    }

    const digits = whatsapp.replace(/\D/g, "");
    const otpRows = await sql`
      SELECT id FROM otp_verificacoes
      WHERE numero = ${digits}
        AND verificado = TRUE
        AND criado_em > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    `;
    if (otpRows.length === 0) {
      return NextResponse.json(
        { erro: "Número de WhatsApp não verificado. Solicite o código e tente novamente." },
        { status: 400 }
      );
    }

    const existing = await sql`
      SELECT id FROM usuarios WHERE email = ${email.toLowerCase().trim()} LIMIT 1
    `;

    if (existing.length > 0) {
      return NextResponse.json({ erro: "Este email já está cadastrado" }, { status: 409 });
    }

    const senha_hash = await hashPassword(senha);
    const emailNorm = email.toLowerCase().trim();

    const result = await sql`
      INSERT INTO usuarios (nome, email, senha_hash, whatsapp, aceita_whatsapp, tipo_usuario)
      VALUES (${nome.trim()}, ${emailNorm}, ${senha_hash}, ${whatsapp || null}, ${aceita_whatsapp || false}, 'free')
      RETURNING id, nome, email, tipo_usuario
    `;

    const user = result[0];

    const token = signToken({
      id: user.id,
      email: user.email,
      tipo_usuario: user.tipo_usuario,
      nome: user.nome,
    });

    let initPoint: string;
    try {
      initPoint = await criarCheckoutMP(user.id, user.email, plano, ref);
    } catch (err) {
      console.error("cadastro: erro ao criar checkout MP", err);
      // Conta já foi criada — loga o usuário mesmo assim para que ele consiga
      // retentar o checkout em /assinar em vez de ficar travado (email já
      // cadastrado, sem sessão e sem link de pagamento).
      const res = NextResponse.json(
        { erro: "Conta criada, mas houve um erro ao gerar o link de pagamento.", redirecionarParaAssinar: true },
        { status: 500 }
      );
      res.cookies.set({ ...cookieOptions(), value: token });
      return res;
    }

    const res = NextResponse.json({ dados: { init_point: initPoint } }, { status: 201 });
    res.cookies.set({ ...cookieOptions(), value: token });
    return res;
  } catch (err) {
    console.error("cadastro error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
