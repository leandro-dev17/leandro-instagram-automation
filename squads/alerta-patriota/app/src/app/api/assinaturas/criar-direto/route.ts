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

// Rate limit simples por IP — rota pública, sem login
const LIMITE_POR_JANELA = 5;
const JANELA_MS = 10 * 60_000;
const requisicoesPorIp = new Map<string, number[]>();

// FASE 27 (item 2): cupons de win-back (enzo-engajamento, ondas D20/D25/D30) prometiam
// desconto em /assinar?...&cupom=VOLTA10, mas só existiam em criar-pix (PIX único, sem UI
// que o chame) — quem cancelou e clicava no link de volta caía em criar-direto (o fluxo
// real, cobrança recorrente por cartão) e pagava o preço cheio, sem desconto nenhum.
// Decisão do usuário: desconto permanente enquanto a assinatura ficar ativa (mais simples,
// sem precisar de uma rotina extra pra reajustar o valor depois do 1º ano). Só Elite, mesma
// regra de negócio já usada em criar-pix.
const CUPONS_DESCONTO: Record<string, number> = {
  VOLTA10: 0.10,
  VOLTA15: 0.15,
  VOLTA20: 0.20,
};

function excedeuLimite(ip: string): boolean {
  const agora = Date.now();
  const historico = (requisicoesPorIp.get(ip) || []).filter((t) => agora - t < JANELA_MS);
  historico.push(agora);
  requisicoesPorIp.set(ip, historico);
  return historico.length > LIMITE_POR_JANELA;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    if (excedeuLimite(ip)) {
      return NextResponse.json({ erro: "Muitas tentativas. Tente novamente em alguns minutos." }, { status: 429 });
    }

    const body = await req.json() as {
      nome?: string;
      email?: string;
      telefone?: string;
      plano?: string;
      ciclo?: string;
      cupom?: string;
    };

    const { nome, email, telefone, plano = "vip", ciclo = "mensal", cupom } = body;

    const fone = (telefone || "").replace(/\D/g, "");
    if (fone.length < 10) {
      return NextResponse.json({ erro: "WhatsApp inválido" }, { status: 400 });
    }

    const emailNorm = (email || "").toLowerCase().trim();
    if (!emailNorm || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailNorm)) {
      return NextResponse.json({ erro: "E-mail inválido" }, { status: 400 });
    }

    const dadosPlano = PLANOS[plano as Plano];
    if (!dadosPlano) {
      return NextResponse.json({ erro: "Plano inválido" }, { status: 400 });
    }

    const nomeUsuario = (nome || "").trim() || "Patriota";
    const valorBase = ciclo === "anual" ? dadosPlano.valorAnual : dadosPlano.valor;
    const desconto = cupom && plano === "elite" ? (CUPONS_DESCONTO[cupom.toUpperCase()] ?? 0) : 0;
    const valorFinal = Math.round(valorBase * (1 - desconto) * 100) / 100;

    // Busca usuário pelo telefone ou e-mail, ou cria novo
    let usuarioId: number | undefined;
    let dbErro: string | undefined;

    const porTelefone = await sql`
      SELECT id FROM usuarios WHERE telefone = ${fone} LIMIT 1
    `.catch((e) => { dbErro = String(e); return [] as Array<{ id: number }>; });

    if ((porTelefone as Array<{ id: number }>).length > 0) {
      usuarioId = (porTelefone as Array<{ id: number }>)[0].id;
      // Nunca sobrescrever um e-mail já cadastrado: alguém que descubra o telefone de
      // outra pessoa não pode sequestrar a conta trocando o e-mail para o próprio.
      // Só preenche se o usuário ainda não tinha e-mail nenhum.
      await sql`UPDATE usuarios SET nome = COALESCE(NULLIF(nome,''), ${nomeUsuario}), email = COALESCE(NULLIF(email,''), ${emailNorm}) WHERE id = ${usuarioId}`.catch(() => {});
    } else {
      const inserido = await sql`
        INSERT INTO usuarios (nome, email, telefone, status, senha_hash)
        VALUES (${nomeUsuario}, ${emailNorm}, ${fone}, 'trial', '__sem_senha__')
        ON CONFLICT (email) DO UPDATE SET
          telefone = COALESCE(EXCLUDED.telefone, usuarios.telefone),
          nome = COALESCE(NULLIF(EXCLUDED.nome,'Patriota'), usuarios.nome)
        RETURNING id
      `.catch((e) => { dbErro = String(e); return [] as Array<{ id: number }>; });

      if ((inserido as Array<{ id: number }>).length > 0) {
        usuarioId = (inserido as Array<{ id: number }>)[0].id;
      } else {
        const porEmail = await sql`SELECT id FROM usuarios WHERE email = ${emailNorm} LIMIT 1`.catch((e) => { dbErro = String(e); return [] as Array<{ id: number }>; });
        usuarioId = (porEmail as Array<{ id: number }>)[0]?.id;
      }
    }

    if (!usuarioId) {
      console.error("criar-direto: usuarioId undefined, dbErro:", dbErro);
      return NextResponse.json({ erro: "Erro ao processar cadastro", detalhe: dbErro || "usuarioId indefinido" }, { status: 500 });
    }

    // FASE 17: nenhuma rota de criação de assinatura checava se o usuário já
    // tinha uma assinatura ativa, permitindo criar uma 2ª cobrança recorrente
    // em cima da 1ª (duplicidade de cobrança).
    const statusAtual = await sql`SELECT status FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
    if (statusAtual[0]?.status === "ativo") {
      return NextResponse.json({ erro: "Você já tem uma assinatura ativa nesse telefone/e-mail. Para alterar seu plano, contate o suporte." }, { status: 409 });
    }

    // start_date alguns minutos no futuro
    const startDate = new Date(Date.now() + 5 * 60 * 1000).toISOString();

    const pa = new PreApproval(client);
    const preApproval = await pa.create({
      body: {
        reason: `Alerta Patriota — ${dadosPlano.nome}`,
        auto_recurring: {
          frequency: ciclo === "anual" ? 12 : 1,
          frequency_type: "months" as const,
          start_date: startDate,
          transaction_amount: valorFinal,
          currency_id: "BRL",
          ...(ciclo === "mensal" ? { free_trial: { frequency: 7, frequency_type: "days" as const } } : {}),
        },
        payer_email: emailNorm,
        external_reference: desconto > 0 ? `${usuarioId}|${plano}|${ciclo}|${cupom!.toUpperCase()}` : `${usuarioId}|${plano}|${ciclo}`,
        back_url: `${APP_URL}/pagamento/sucesso?plano=${plano}`,
        payment_methods_allowed: {
          payment_types: [{ id: "credit_card" }],
        },
        // notification_url existe na API real do Mercado Pago, mas falta no tipo do SDK
        notification_url: `${APP_URL}/api/webhook/mercadopago`,
      } as Parameters<typeof pa.create>[0]["body"],
    });

    return NextResponse.json({ ok: true, checkout_url: preApproval.init_point });
  } catch (err: unknown) {
    const mpErr = err as { message?: string; cause?: unknown; status?: number };
    console.error("criar-direto error:", JSON.stringify(mpErr, null, 2));
    const detalhe = mpErr?.message || String(err);
    return NextResponse.json({ erro: "Erro ao criar assinatura", detalhe }, { status: 500 });
  }
}
