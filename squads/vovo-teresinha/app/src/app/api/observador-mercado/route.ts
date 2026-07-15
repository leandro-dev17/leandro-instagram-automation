import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { registrarFalha } from "@/lib/agente-falha";

// Monitora o mercado de apps de receitas saudáveis no Brasil semanalmente.
// Usa Claude com conhecimento de treinamento + métricas internas do app como contexto.

// maxDuration = 60s: necessário pois este endpoint NÃO está no vercel.json como cron.
// Sem esta declaração a Vercel aplica o timeout padrão de 10s, que aborta a chamada
// à Anthropic antes de completar → HTTP 0 / AbortError.
export const maxDuration = 60;

async function analisarMercado(
  totalReceitas: number,
  totalUsuarios: number,
  mrr: number
): Promise<string | null> {
  // eslint-disable-next-line no-control-regex
  const apiKey = (process.env.ANTHROPIC_API_KEY ?? "").replace(/[^\x20-\x7E]/g, "").trim();
  if (!apiKey) return null;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5",
      max_tokens: 600,
      messages: [
        {
          role: "user",
          content: `Você é um analista de mercado especializado em apps de culinária e saúde no Brasil.

Contexto do nosso app "Vovó Teresinha" (receitas saudáveis brasileiras):
- Total de receitas no banco: ${totalReceitas}
- Total de usuários: ${totalUsuarios}
- MRR atual: R$${mrr.toFixed(2)}
- Planos: Caderninho R$9,90/mês (80 receitas) / Livro de Receitas R$19,90/mês (400+ receitas, 7 dias grátis)
- Diferenciais: receitas saudáveis, curadoria da Vovó Teresinha, PWA com push, grupo WhatsApp

Faça uma análise semanal de mercado concisa (máx. 4 parágrafos):
1. Principais apps concorrentes brasileiros de receitas saudáveis e seus diferenciais
2. Tendências atuais do mercado de alimentação saudável no Brasil
3. Oportunidades de crescimento para o nosso app
4. 1 recomendação prioritária de ação para esta semana

Seja direto e prático. Foque no que é acionável.`,
        },
      ],
    }),
    // 50s para a Anthropic — deixa ~10s de margem para DB + Telegram + overhead
    // dentro do limite de 60s garantido pelo export maxDuration = 60 acima.
    signal: AbortSignal.timeout(50000),
  });

  if (!res.ok) return null;
  const data = await res.json();
  return data.content?.[0]?.text ?? null;
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Métricas internas como contexto para a análise
    const [statsReceitas, statsUsuarios, statsMrr] = await Promise.all([
      sql<{ total: number }[]>`SELECT COUNT(*) AS total FROM receitas`,
      sql<{ total: number }[]>`SELECT COUNT(*) AS total FROM usuarios`,
      sql<{ mrr: number }[]>`
        SELECT COALESCE(SUM(valor), 0) AS mrr
        FROM assinaturas
        WHERE status = 'active'
      `,
    ]);

    const totalReceitas = Number(statsReceitas[0]?.total ?? 0);
    const totalUsuarios = Number(statsUsuarios[0]?.total ?? 0);
    const mrr = Number(statsMrr[0]?.mrr ?? 0);

    const analise = await analisarMercado(totalReceitas, totalUsuarios, mrr);

    if (!analise) {
      await registrarFalha(
        "observador-mercado",
        "Anthropic API retornou resposta vazia ou inválida",
        { totalReceitas, totalUsuarios, mrr }
      );
      return NextResponse.json(
        { erro: "Falha ao obter análise de mercado" },
        { status: 502 }
      );
    }

    // Registra a análise no banco para histórico
    await sql`
      INSERT INTO analises_mercado (agente, conteudo, criado_em)
      VALUES ('observador-mercado', ${analise}, NOW())
    `;

    // Notifica via Telegram
    const resumo =
      analise.length > 800 ? analise.slice(0, 797) + "…" : analise;
    await enviarTelegram(
      `📊 <b>Análise Semanal de Mercado</b>\n\n${resumo}`
    );

    return NextResponse.json({
      ok: true,
      totalReceitas,
      totalUsuarios,
      mrr,
      analise,
    });
  } catch (err) {
    const mensagem =
      err instanceof Error ? err.message : "Erro desconhecido";

    // Distingue AbortError (timeout Anthropic) de outros erros
    const isAbort =
      err instanceof Error && err.name === "AbortError";

    await registrarFalha(
      "observador-mercado",
      isAbort
        ? `Timeout na chamada à Anthropic (>50s): ${mensagem}`
        : `Erro inesperado: ${mensagem}`,
      { isAbort }
    );

    return NextResponse.json(
      { erro: "Erro interno no observador de mercado" },
      { status: 500 }
    );
  }
}
