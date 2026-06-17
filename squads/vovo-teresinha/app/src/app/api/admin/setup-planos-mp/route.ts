import { NextRequest, NextResponse } from "next/server";
import { MercadoPagoConfig, PreApprovalPlan } from "mercadopago";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

const CRON_SECRET = process.env.CRON_SECRET;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";

const PLANOS_CONFIG = [
  {
    key: "mensal",
    reason: "Receitinhas Premium - Mensal",
    frequency: 1,
    transaction_amount: 9.9,
    freeTrialDias: 0,
  },
  {
    key: "trimestral",
    reason: "Receitinhas Premium - Trimestral",
    frequency: 3,
    transaction_amount: 29.9,
    freeTrialDias: 7,
  },
  {
    key: "anual",
    reason: "Receitinhas Premium - Anual",
    frequency: 12,
    transaction_amount: 79.9,
    freeTrialDias: 7,
  },
];

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const planClient = new PreApprovalPlan(client);
  const resultados: Record<string, string> = {};
  const erros: Record<string, string> = {};

  for (const plano of PLANOS_CONFIG) {
    try {
      const body = {
        reason: plano.reason,
        status: "active",
        back_url: `${APP_URL}/pagamento/sucesso`,
        auto_recurring: {
          frequency: plano.frequency,
          frequency_type: "months",
          transaction_amount: plano.transaction_amount,
          currency_id: "BRL",
          ...(plano.freeTrialDias > 0
            ? { free_trial: { frequency: plano.freeTrialDias, frequency_type: "days" } }
            : {}),
        },
        payment_methods_allowed: {
          payment_types: [{ id: "credit_card" }],
        },
      };

      const resultado = await planClient.create({ body });
      resultados[plano.key] = resultado.id!;
    } catch (err) {
      erros[plano.key] = err instanceof Error ? err.message : String(err);
    }
  }

  return NextResponse.json({ planos_criados: resultados, erros });
}
