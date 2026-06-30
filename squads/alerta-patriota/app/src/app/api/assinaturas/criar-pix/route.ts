import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { randomUUID, createHash } from "crypto";
import bcrypt from "bcryptjs";
import { validarCupom } from "@/lib/cupons";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const MP_TOKEN = process.env.MERCADOPAGO_ACCESS_TOKEN!;

const VALORES_ANUAIS: Record<string, number> = {
  vip: 99,
  elite: 199,
};

// Rate limit simples por IP — rota pública, sem login
const LIMITE_POR_JANELA = 5;

// Fase 34 (backlog seg/infra, item 2): Map em memória do processo não funciona em
// serverless (cada cold start/instância concorrente tem memória isolada) — o limite
// nunca era de fato global por IP. Persistido em assinaturas_rate_limit (tabela criada
// em admin/setup/route.ts), mesmo padrão já usado em leads/registrar/route.ts.
async function excedeuLimite(ip: string): Promise<boolean> {
  const rows = await sql`
    SELECT COUNT(*)::int AS total FROM assinaturas_rate_limit
    WHERE ip = ${ip} AND rota = 'criar-pix' AND created_at > NOW() - INTERVAL '10 minutes'
  `;
  await sql`INSERT INTO assinaturas_rate_limit (ip, rota) VALUES (${ip}, 'criar-pix')`;
  await sql`DELETE FROM assinaturas_rate_limit WHERE created_at < NOW() - INTERVAL '1 hour'`.catch(() => {});
  return (rows[0]?.total ?? 0) >= LIMITE_POR_JANELA;
}

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "desconhecido";
    if (await excedeuLimite(ip)) {
      return NextResponse.json({ erro: "Muitas tentativas. Tente novamente em alguns minutos." }, { status: 429 });
    }

    const body = await req.json() as {
      email: string;
      nome: string;
      telefone?: string;
      plano: string;
      ciclo: string;
      cpf?: string;
    };

    const { email, nome, telefone, plano, ciclo, cupom, cpf } = body as typeof body & { cupom?: string };

    if (!email || !nome || !plano) {
      return NextResponse.json({ erro: "Campos obrigatórios: email, nome, plano" }, { status: 400 });
    }

    // CPF é exigido pelo Mercado Pago para identificar o pagador de PIX no Brasil —
    // enviar vazio fazia o pagamento ir sem identificação real do pagador.
    const cpfLimpo = (cpf || "").replace(/\D/g, "");
    if (cpfLimpo.length !== 11) {
      return NextResponse.json({ erro: "CPF inválido. Informe um CPF com 11 dígitos." }, { status: 400 });
    }

    if (!VALORES_ANUAIS[plano]) {
      return NextResponse.json({ erro: "Plano inválido. Use: vip, elite" }, { status: 400 });
    }

    if (ciclo !== "anual") {
      return NextResponse.json({ erro: "Esta rota aceita apenas ciclo anual" }, { status: 400 });
    }

    // Busca usuário existente ou cria um novo (necessário para ativar acesso após o pagamento)
    let usuarioId: number;
    const usuarios = await sql`SELECT id, status FROM usuarios WHERE email = ${email.toLowerCase()} LIMIT 1`;
    if (usuarios.length > 0) {
      if (usuarios[0].status === "ativo") {
        // FASE 41 (bug 2 + bug 3 da auditoria aprofundada):
        // Bug 2 — admin/reativar seta usuarios.status='ativo' sem recriar a assinatura no MP.
        //   Checar só usuarios.status bloqueava o usuário de refazer a assinatura com 409.
        // Bug 3 — PIX anual nunca expira automaticamente (não há webhook de renovação para PIX).
        //   Após 360 dias, o assinante não conseguia refazer o PIX porque a assinatura
        //   ainda constava como 'ativa' no banco.
        // Solução: bloquear apenas quando há de fato uma assinatura 'ativa' que não seja
        // um PIX anual expirado (ciclo='anual', sem renovações, criada há mais de 360 dias).
        const ativa = await sql`
          SELECT 1 FROM assinaturas
          WHERE usuario_id = ${usuarios[0].id} AND status = 'ativa'
            AND NOT (ciclo = 'anual' AND renovada_em IS NULL AND created_at < NOW() - INTERVAL '360 days')
          LIMIT 1
        `;
        if (ativa.length > 0) {
          return NextResponse.json({ erro: "Você já tem uma assinatura ativa nesse e-mail. Para alterar seu plano, contate o suporte." }, { status: 409 });
        }
      }
      usuarioId = usuarios[0].id;
    } else {
      // FASE 27.6: SELECT (sem usuário) seguido de INSERT puro tinha uma janela TOCTOU — duplo
      // clique ou retry do cliente PIX (rede lenta é comum nesse fluxo) gerava 2 requisições
      // concorrentes que ambas viam "não existe" e ambas tentavam INSERT com o mesmo e-mail
      // (UNIQUE). A segunda batia no constraint, não tinha .catch() aqui, e a request inteira
      // falhava com 500 — em vez de simplesmente reaproveitar o usuário já criado pela primeira.
      // ON CONFLICT...RETURNING (mesmo padrão de criar-direto/route.ts) sempre retorna uma linha,
      // não importa qual das duas requisições "ganhou" a corrida.
      const senhaAleatoria = await bcrypt.hash(randomUUID(), 10);
      const novoUsuario = await sql`
        INSERT INTO usuarios (nome, email, senha_hash, telefone, status)
        VALUES (${nome}, ${email.toLowerCase()}, ${senhaAleatoria}, ${telefone || null}, 'trial')
        ON CONFLICT (email) DO UPDATE SET
          telefone = COALESCE(usuarios.telefone, EXCLUDED.telefone)
        RETURNING id
      `;
      usuarioId = novoUsuario[0].id;
    }

    const { desconto, codigo: cupomAplicado } = await validarCupom(cupom, plano, usuarioId);
    const valor = Math.round(VALORES_ANUAIS[plano] * (1 - desconto) * 100) / 100;

    // FASE 39 (achado 2 da re-checagem da Fase 30): antes, idempotencyKey = randomUUID() era
    // gerada a cada requisição HTTP — retry de rede ou duplo-clique no botão "Gerar PIX" virava
    // uma chave nova a cada vez, então o Mercado Pago nunca via a "mesma" tentativa duas vezes e
    // cada clique gerava um PIX pendente novo (não cobra duplicado, já que só cobra se pago, mas
    // polui `pagamentos` com pendentes órfãos e confunde o reconciliador da Fase 33). Chave
    // determinística por usuário+plano, num bucket de 10min (mesma janela do rate limit acima):
    // retries dentro da janela reusam a mesma chave e o MP devolve a cobrança já criada em vez de
    // criar outra. Se o corpo da chamada mudar dentro da janela (ex.: cupom só aplicado na 1ª
    // tentativa), o MP recusa por segurança em vez de misturar dados — o usuário só precisa
    // tentar de novo, fora da janela.
    const bucket = Math.floor(Date.now() / (10 * 60 * 1000));
    const idempotencyKey = createHash("sha256").update(`${usuarioId}|${plano}|criar-pix|${bucket}`).digest("hex");

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
          identification: { type: "CPF", number: cpfLimpo },
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
      INSERT INTO pagamentos (usuario_id, valor, status, mp_payment_id, metodo, cupom)
      VALUES (${usuarioId}, ${valor}, 'pendente', ${paymentId}, 'pix', ${cupomAplicado})
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
