import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { criarCheckoutMP } from "@/lib/mercadopago";
import { PLANOS } from "@/lib/planos";

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
      return NextResponse.json({ erro: "Plano inválido. Use: caderninho ou livro_receitas" }, { status: 400 });
    }

    const uRows = await queryWithRetry(() => sql`SELECT tipo_usuario, trial_fim FROM usuarios WHERE id = ${session.id} LIMIT 1`);
    console.log("assinaturas/criar: uRows.length=", uRows.length);
    if (uRows.length === 0) {
      console.error("assinaturas/criar: usuário não encontrado para id=", session.id);
      return NextResponse.json({ erro: "Sessão expirada. Faça login novamente." }, { status: 401 });
    }

    if (uRows[0].tipo_usuario === "aluna_leandro") {
      return NextResponse.json({ erro: "Você já tem acesso premium como aluna do Leandro!" }, { status: 400 });
    }

    if (uRows[0].tipo_usuario === "premium") {
      return NextResponse.json({
        erro: "Você já tem uma assinatura ativa. Cancele a atual antes de assinar outro plano.",
      }, { status: 400 });
    }

    const info = PLANOS[plano as keyof typeof PLANOS];

    // Bloqueia segundo trial: se o plano tem período grátis e o usuário já usou trial antes
    if (info.freeTrialDias > 0 && uRows[0].trial_fim !== null) {
      return NextResponse.json({
        erro: "Você já utilizou seu período de teste gratuito. Assine normalmente para continuar tendo acesso.",
      }, { status: 400 });
    }

    let initPoint: string;
    try {
      initPoint = await criarCheckoutMP(session.id, session.email, plano as keyof typeof PLANOS, codigo_afiliado);
    } catch (err) {
      console.error("assinaturas/criar: erro ao criar checkout MP", err);
      return NextResponse.json({ erro: "Erro ao gerar link de pagamento. Tente novamente." }, { status: 500 });
    }

    return NextResponse.json({ dados: { init_point: initPoint } });
  } catch (err) {
    console.error("assinaturas/criar error", err);
    const msg = err instanceof Error ? err.message : "Erro interno";
    return NextResponse.json({ erro: `Erro ao processar pagamento: ${msg}` }, { status: 500 });
  }
}
