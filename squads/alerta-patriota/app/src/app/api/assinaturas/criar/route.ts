import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import { getUsuarioLogado } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { Plano } from "@/lib/db";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

// Valores dos planos (apenas VIP e Elite — Básico/Patriota descontinuados)
const PLANOS: Partial<Record<Plano, { nome: string; valor: number; valorAnual: number }>> = {
  vip:      { nome: "VIP Premium",  valor: 9.90,  valorAnual: 99.00  },
  elite:    { nome: "Elite Global", valor: 19.90, valorAnual: 199.00 },
};

export async function POST(req: NextRequest) {
  try {
    const usuario = await getUsuarioLogado();
    if (!usuario) {
      return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    }

    const { plano, ciclo = "mensal", telefone } = await req.json() as { plano: Plano; ciclo?: "mensal" | "anual"; telefone?: string };

    const dadosPlano = PLANOS[plano];
    if (!dadosPlano) {
      return NextResponse.json({ erro: "Plano inválido" }, { status: 400 });
    }

    const { valor, valorAnual, nome } = dadosPlano;
    const valorFinal = ciclo === "anual" ? valorAnual : valor;

    // Salva telefone do usuário se ainda não tiver (necessário para o grupo WhatsApp)
    if (telefone) {
      const fone = telefone.replace(/\D/g, "");
      if (fone.length >= 10) {
        await sql`UPDATE usuarios SET telefone = ${fone} WHERE id = ${usuario.id} AND telefone IS NULL`.catch(() => {});
      }
    }

    // Cria a pré-aprovação (assinatura recorrente)
    const preApprovalClient = new PreApproval(client);
    const preApproval = await preApprovalClient.create({
      body: {
        reason: `Alerta Patriota — ${nome} (${ciclo})`,
        auto_recurring: {
          frequency: ciclo === "anual" ? 12 : 1,
          frequency_type: "months" as const,
          transaction_amount: valorFinal,
          currency_id: "BRL",
          ...(ciclo === "mensal" ? { free_trial: { frequency: 7, frequency_type: "days" as const } } : {}),
        },
        payer_email: usuario.email,
        external_reference: `${usuario.id}|${plano}|${ciclo}`,
        back_url: `${APP_URL}/pagamento/sucesso`,
        notification_url: `${APP_URL}/api/webhook/mercadopago`,
      },
    });

    return NextResponse.json({
      ok: true,
      checkout_url: preApproval.init_point,
      subscription_id: preApproval.id,
    });
  } catch (err) {
    console.error("assinaturas/criar error:", err);
    return NextResponse.json({ erro: "Erro ao criar assinatura" }, { status: 500 });
  }
}
