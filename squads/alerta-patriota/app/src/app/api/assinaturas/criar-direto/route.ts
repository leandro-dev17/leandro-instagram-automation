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
      email?: string;
      telefone?: string;
      plano?: string;
      ciclo?: string;
    };

    const { nome, email, telefone, plano = "vip", ciclo = "mensal" } = body;

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
    const valorFinal = ciclo === "anual" ? dadosPlano.valorAnual : dadosPlano.valor;

    // Busca usuário pelo telefone ou e-mail, ou cria novo
    let usuarioId: number | undefined;
    let dbErro: string | undefined;

    const porTelefone = await sql`
      SELECT id FROM usuarios WHERE telefone = ${fone} LIMIT 1
    `.catch((e) => { dbErro = String(e); return [] as Array<{ id: number }>; });

    if ((porTelefone as Array<{ id: number }>).length > 0) {
      usuarioId = (porTelefone as Array<{ id: number }>)[0].id;
      await sql`UPDATE usuarios SET nome = COALESCE(NULLIF(nome,''), ${nomeUsuario}), email = ${emailNorm} WHERE id = ${usuarioId}`.catch(() => {});
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
        external_reference: `${usuarioId}|${plano}|${ciclo}`,
        back_url: `${APP_URL}/pagamento/sucesso?plano=${plano}`,
        notification_url: `${APP_URL}/api/webhook/mercadopago`,
        payment_methods_allowed: {
          payment_types: [{ id: "credit_card" }],
        },
      },
    });

    return NextResponse.json({ ok: true, checkout_url: preApproval.init_point });
  } catch (err: unknown) {
    const mpErr = err as { message?: string; cause?: unknown; status?: number };
    console.error("criar-direto error:", JSON.stringify(mpErr, null, 2));
    const detalhe = mpErr?.message || String(err);
    return NextResponse.json({ erro: "Erro ao criar assinatura", detalhe }, { status: 500 });
  }
}
