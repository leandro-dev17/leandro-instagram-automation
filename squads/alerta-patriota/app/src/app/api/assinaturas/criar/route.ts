import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import { getUsuarioLogado } from "@/lib/auth";
import { sql } from "@/lib/db";
import type { Plano } from "@/lib/db";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

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

    if (telefone) {
      const fone = telefone.replace(/\D/g, "");
      if (fone.length >= 10) {
        await sql`UPDATE usuarios SET telefone = ${fone} WHERE id = ${usuario.id} AND telefone IS NULL`.catch(() => {});
      }
    }

    // start_date deve ser alguns minutos no futuro
    const startDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const preApprovalClient = new PreApproval(client);
    const preApproval = await preApprovalClient.create({
      body: {
        reason: `Alerta Patriota — ${nome} (${ciclo})`,
        auto_recurring: {
          frequency: ciclo === "anual" ? 12 : 1,
          frequency_type: "months" as const,
          start_date: startDate,
          transaction_amount: valorFinal,
          currency_id: "BRL",
          ...(ciclo === "mensal" ? { free_trial: { frequency: 7, frequency_type: "days" as const } } : {}),
        },
        external_reference: `${usuario.id}|${plano}|${ciclo}`,
        back_url: `${APP_URL}/pagamento/sucesso`,
        notification_url: `${APP_URL}/api/webhook/mercadopago`,
        payment_methods_allowed: {
          payment_types: [{ id: "credit_card" }],
        },
      },
    });

    return NextResponse.json({
      ok: true,
      checkout_url: preApproval.init_point,
      subscription_id: preApproval.id,
    });
  } catch (err: unknown) {
    const mpErr = err as { message?: string; cause?: unknown; status?: number };
    console.error("assinaturas/criar error:", JSON.stringify(mpErr, null, 2));
    const detalhe = mpErr?.message || String(err);
    return NextResponse.json({ erro: "Erro ao criar assinatura", detalhe }, { status: 500 });
  }
}
