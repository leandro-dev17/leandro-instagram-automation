import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import { sql } from "@/lib/db";
import type { Plano } from "@/lib/db";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

const PLANOS: Partial<Record<Plano, { nome: string; valor: number; valorAnual: number }>> = {
  vip:   { nome: "VIP Premium",  valor: 9.90,  valorAnual: 99.00  },
  elite: { nome: "Elite Global", valor: 19.90, valorAnual: 199.00 },
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      nome?: string;
      telefone?: string;
      plano?: string;
      ciclo?: string;
    };

    const { nome, telefone, plano = "vip", ciclo = "mensal" } = body;

    const fone = (telefone || "").replace(/\D/g, "");
    if (fone.length < 10) {
      return NextResponse.json({ erro: "WhatsApp inválido" }, { status: 400 });
    }

    const dadosPlano = PLANOS[plano as Plano];
    if (!dadosPlano) {
      return NextResponse.json({ erro: "Plano inválido" }, { status: 400 });
    }

    const nomeUsuario = (nome || "").trim() || "Patriota";
    const valorFinal = ciclo === "anual" ? dadosPlano.valorAnual : dadosPlano.valor;
    const emailPlaceholder = `tel${fone}@alertapatriota.com.br`;

    // Busca usuário pelo telefone ou cria novo
    let usuarioId: number | undefined;

    const porTelefone = await sql`
      SELECT id FROM usuarios WHERE telefone = ${fone} LIMIT 1
    `.catch(() => [] as Array<{ id: number }>);

    if (porTelefone.length > 0) {
      usuarioId = porTelefone[0].id;
      await sql`UPDATE usuarios SET nome = COALESCE(NULLIF(nome,''), ${nomeUsuario}) WHERE id = ${usuarioId}`.catch(() => {});
    } else {
      const inserido = await sql`
        INSERT INTO usuarios (nome, email, telefone, status)
        VALUES (${nomeUsuario}, ${emailPlaceholder}, ${fone}, 'pendente')
        ON CONFLICT (email) DO UPDATE SET telefone = EXCLUDED.telefone
        RETURNING id
      `.catch(() => [] as Array<{ id: number }>);

      if ((inserido as Array<{ id: number }>).length > 0) {
        usuarioId = (inserido as Array<{ id: number }>)[0].id;
      } else {
        const porEmail = await sql`SELECT id FROM usuarios WHERE email = ${emailPlaceholder} LIMIT 1`.catch(() => [] as Array<{ id: number }>);
        usuarioId = (porEmail as Array<{ id: number }>)[0]?.id;
      }
    }

    if (!usuarioId) {
      return NextResponse.json({ erro: "Erro ao processar cadastro" }, { status: 500 });
    }

    // Cria PreApproval no Mercado Pago
    const pa = new PreApproval(client);
    const preApproval = await pa.create({
      body: {
        reason: `Alerta Patriota — ${dadosPlano.nome}`,
        auto_recurring: {
          frequency: ciclo === "anual" ? 12 : 1,
          frequency_type: "months" as const,
          transaction_amount: valorFinal,
          currency_id: "BRL",
          ...(ciclo === "mensal" ? { free_trial: { frequency: 7, frequency_type: "days" as const } } : {}),
        },
        payer_email: emailPlaceholder,
        external_reference: `${usuarioId}|${plano}|${ciclo}`,
        back_url: `${APP_URL}/pagamento/sucesso`,
        notification_url: `${APP_URL}/api/webhook/mercadopago`,
      },
    });

    return NextResponse.json({ ok: true, checkout_url: preApproval.init_point });
  } catch (err) {
    console.error("criar-direto error:", err);
    return NextResponse.json({ erro: "Erro ao criar assinatura" }, { status: 500 });
  }
}
