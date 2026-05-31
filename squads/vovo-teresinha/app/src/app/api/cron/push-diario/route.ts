import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

function autorizado(req: NextRequest): { ok: boolean; motivo?: string } {
  const secret = process.env.CRON_SECRET;
  const isProd = process.env.NODE_ENV === "production";

  if (!secret) {
    if (isProd) {
      console.error(
        "[push-diario] CRON_SECRET ausente nas variáveis de ambiente de produção. " +
          "Acesse Vercel Dashboard → Settings → Environment Variables, " +
          "adicione CRON_SECRET e faça redeploy."
      );
      return { ok: false, motivo: "secret_ausente" };
    }
    console.warn("[push-diario] CRON_SECRET não definido — acesso permitido fora de produção.");
    return { ok: true };
  }

  const authHeader = req.headers.get("authorization") ?? "";
  const esperado = `Bearer ${secret}`;
  if (authHeader !== esperado) {
    console.warn(
      "[push-diario] Header Authorization inválido. " +
        `Recebido: "${authHeader.substring(0, 15)}${authHeader.length > 15 ? "…" : ""}" ` +
        "(esperado: \"Bearer ***\")."
    );
    return { ok: false, motivo: "header_invalido" };
  }

  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = autorizado(req);
  if (!auth.ok) {
    return NextResponse.json(
      {
        erro: "Não autorizado",
        ...(process.env.NODE_ENV !== "production" && { diagnostico: auth.motivo }),
      },
      { status: 401 }
    );
  }

  const sql = neon(process.env.DATABASE_URL!);

  try {
    // Busca usuários com assinatura ativa que aceitaram push notifications
    const destinatarios = await sql`
      SELECT u.id AS usuario_id, u.email, u.nome, pn.endpoint, pn.chave_p256dh, pn.chave_auth
      FROM usuarios u
      JOIN push_subscriptions pn ON pn.usuario_id = u.id
      JOIN assinaturas a ON a.usuario_id = u.id
      WHERE a.status IN ('ativa', 'trial')
        AND pn.ativo = true
      LIMIT 500
    `;

    // Busca receita do dia (mais recente criada hoje ou ontem)
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    const hojeIso = hoje.toISOString();

    const [receitaDia] = await sql`
      SELECT id, titulo, descricao
      FROM receitas
      WHERE criada_em >= ${hojeIso}::timestamptz
      ORDER BY criada_em DESC
      LIMIT 1
    `;

    console.log(
      `[push-diario] Destinatários: ${destinatarios.length} | Receita do dia: ${receitaDia?.titulo ?? "nenhuma"}`
    );

    return NextResponse.json({
      ok: true,
      destinatarios: destinatarios.length,
      receita_dia: receitaDia ?? null,
      // O envio efetivo das notificações push deve ser feito por worker separado
      // usando as subscriptions retornadas. Este endpoint apenas coleta os dados.
      subscriptions: destinatarios,
    });
  } catch (err: unknown) {
    const mensagem = err instanceof Error ? err.message : String(err);
    console.error("[push-diario] Erro:", mensagem);
    return NextResponse.json(
      { erro: "Erro interno no push diário", detalhe: mensagem },
      { status: 500 }
    );
  }
}
