import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { MercadoPagoConfig, PreApproval } from "mercadopago";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

const PLANOS = {
  trimestral: { titulo: "Receitinhas Premium - Trimestral", valor: 29.9, frequencia: 3 },
  anual: { titulo: "Receitinhas Premium - Anual", valor: 79.9, frequencia: 12 },
};

async function queryWithRetry<T>(fn: () => Promise<T>, retries = 2): Promise<T> {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (err: unknown) {
      const isNeonError = err && typeof err === "object" && "constructor" in err && (err as { constructor: { name: string } }).constructor.name === "NeonDbError";
      if (i < retries && isNeonError) {
        await new Promise((r) => setTimeout(r, 800 * (i + 1)));
        continue;
      }
      throw err;
    }
  }
  throw new Error("unreachable");
}

export async function POST(req: NextRequest) {
  try {
    const session = await getSession();
    console.log("assinaturas/criar: session=", session ? `id=${session.id} tipo=${session.tipo_usuario}` : "null");
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const { plano, codigo_afiliado } = await req.json();

    if (!plano || !PLANOS[plano as keyof typeof PLANOS]) {
      return NextResponse.json({ erro: "Plano inválido. Use: mensal ou anual" }, { status: 400 });
    }

    const uRows = await queryWithRetry(() => sql`SELECT tipo_usuario FROM usuarios WHERE id = ${session.id} LIMIT 1`);
    console.log("assinaturas/criar: uRows.length=", uRows.length);
    if (uRows.length === 0) {
      console.error("assinaturas/criar: usuário não encontrado para id=", session.id);
      return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
    }

    if (uRows[0].tipo_usuario === "aluna_leandro") {
      return NextResponse.json({ erro: "Você já tem acesso premium como aluna do Leandro!" }, { status: 400 });
    }

    const info = PLANOS[plano as keyof typeof PLANOS];
    const preApprovalClient = new PreApproval(client);

    // external_reference codifica: userId|plano|codigoAfiliado
    const extRef = `${session.id}|${plano}|${codigo_afiliado || ""}`;

    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";

    const result = await preApprovalClient.create({
      body: {
        reason: info.titulo,
        auto_recurring: {
          frequency: info.frequencia,
          frequency_type: "months",
          transaction_amount: info.valor,
          currency_id: "BRL",
        },
        payer_email: session.email,
        external_reference: extRef,
        back_url: `${appUrl}/pagamento/sucesso`,
        status: "pending",
      },
    });

    if (!result.init_point) {
      console.error("assinaturas/criar: init_point ausente", result);
      return NextResponse.json({ erro: "Erro ao gerar link de pagamento. Tente novamente." }, { status: 500 });
    }

    return NextResponse.json({ dados: { init_point: result.init_point, id: result.id } });
  } catch (err) {
    console.error("assinaturas/criar error", err);
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ erro: `Erro ao processar pagamento: ${msg}` }, { status: 500 });
  }
}
