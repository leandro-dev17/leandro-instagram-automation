import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN!;

const VALORES_ANUAIS: Record<string, number> = {
  vip: 99,
  elite: 199,
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      email: string;
      nome: string;
      telefone?: string;
      plano: string;
      ciclo: string;
    };

    const { email, nome, telefone, plano, ciclo } = body;

    if (!email || !nome || !plano) {
      return NextResponse.json({ erro: "Campos obrigatórios: email, nome, plano" }, { status: 400 });
    }

    if (!VALORES_ANUAIS[plano]) {
      return NextResponse.json({ erro: "Plano inválido. Use: vip, elite" }, { status: 400 });
    }

    if (ciclo !== "anual") {
      return NextResponse.json({ erro: "Esta rota aceita apenas ciclo anual" }, { status: 400 });
    }

    const valor = VALORES_ANUAIS[plano];
    const idempotencyKey = randomUUID();

    // Busca usuário existente ou cria um novo (necessário para ativar acesso após o pagamento)
    let usuarioId: number;
    const usuarios = await sql`SELECT id FROM usuarios WHERE email = ${email.toLowerCase()} LIMIT 1`;
    if (usuarios.length > 0) {
      usuarioId = usuarios[0].id;
    } else {
      const senhaAleatoria = await bcrypt.hash(randomUUID(), 10);
      const novoUsuario = await sql`
        INSERT INTO usuarios (nome, email, senha_hash, telefone, status)
        VALUES (${nome}, ${email.toLowerCase()}, ${senhaAleatoria}, ${telefone || null}, 'trial')
        RETURNING id
      `;
      usuarioId = novoUsuario[0].id;
    }

    const mpRes = await fetch("https://api.mercadopago.com/v1/payments", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MP_TOKEN}`,
        "Content-Type": "application/json",
        "X-Idempotency-Key": idempotencyKey,
      },
      body: JSON.stringify({
        transaction_amount: valor,
        payment_method_id: "pix",
        payer: {
          email,
          first_name: nome.split(" ")[0],
          last_name: nome.split(" ").slice(1).join(" ") || "",
          identification: { type: "CPF", number: "" },
        },
        description: `Alerta Patriota - Plano ${plano.charAt(0).toUpperCase() + plano.slice(1)} Anual`,
        notification_url: `${APP_URL}/api/webhook/mercadopago`,
        metadata: { usuario_id: usuarioId, plano, ciclo: "anual", email },
      }),
    });

    if (!mpRes.ok) {
      const err = await mpRes.text();
      console.error("MP erro:", err);
      return NextResponse.json({ erro: "Erro ao criar pagamento no Mercado Pago" }, { status: 502 });
    }

    const mpData = await mpRes.json() as {
      id: number;
      point_of_interaction?: {
        transaction_data?: {
          qr_code?: string;
          qr_code_base64?: string;
        };
      };
      status: string;
    };

    const qrCode = mpData.point_of_interaction?.transaction_data?.qr_code ?? null;
    const qrBase64 = mpData.point_of_interaction?.transaction_data?.qr_code_base64 ?? null;
    const paymentId = String(mpData.id);

    await sql`
      INSERT INTO pagamentos (usuario_id, valor, status, mp_payment_id, metodo)
      VALUES (${usuarioId}, ${valor}, 'pendente', ${paymentId}, 'pix')
    `;

    return NextResponse.json({
      ok: true,
      qr_code: qrCode,
      qr_code_base64: qrBase64,
      payment_id: paymentId,
      valor,
    });
  } catch (err) {
    console.error("criar-pix error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
