import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha } from "@/lib/agente-falha";
import { gerarTexto } from "@/lib/ai";

// Monitora o mercado de apps de receitas saudáveis no Brasil semanalmente.
// Usa Groq/Cerebras (Llama 3.3 70B) + métricas internas do app como contexto.

// Declara maxDuration de 60s: sem isso a Vercel aplica o timeout padrão de 10s,
// que pode abortar a chamada à IA antes dela completar → AbortError HTTP 0.
export const maxDuration = 60;

async function analisarMercado(
  totalReceitas: number,
  totalUsuarios: number,
  mrr: number
): Promise<string | null> {
  return gerarTexto({
    max_tokens: 600,
    messages: [{
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
    }],
  }).catch(() => null);
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Métricas internas como contexto para a análise
    const [statsReceitas, statsUsuarios, statsMrr] = await Promise.all([
      sql`SELECT COUNT(*) as total FROM receitas`.catch(() => [{ total: 0 }]),
      sql`SELECT COUNT(*) as total FROM usuarios`.catch(() => [{ total: 0 }]),
      sql`SELECT COALESCE(SUM(valor), 0) as mrr FROM assinaturas WHERE status = 'ativo'`.catch(() => [{ mrr: 0 }]),
    ]);

    const totalReceitas = Number(statsReceitas[0]?.total ?? 0);
    const totalUsuarios = Number(statsUsuarios[0]?.total ?? 0);
    const mrr = Number(statsMrr[0]?.mrr ?? 0);

    const analise = await analisarMercado(totalReceitas, totalUsuarios, mrr);

    const semana = new Date().toLocaleDateString("pt-BR");

    if (analise) {
      await enviarTelegram(
        `🔍 <b>Observador de Mercado — ${semana}</b>\n\n` +
        analise.slice(0, 3500) +
        `\n\n<i>Análise baseada em dados de mercado + métricas do app.</i>`
      );

      // Salvar análise no banco para histórico
      await sql`
        INSERT INTO app_configuracoes (chave, valor)
        VALUES (${`mercado_analise_${new Date().toISOString().slice(0, 10)}`}, ${analise})
        ON CONFLICT (chave) DO UPDATE SET valor = ${analise}
      `.catch(() => null);
    } else {
      await enviarTelegram(`🔍 <b>Observador de Mercado</b>\n\nNão foi possível gerar análise esta semana.`);
    }

    return NextResponse.json({ ok: true, analise: analise ? analise.slice(0, 200) + "..." : null });
  } catch (err) {
    await reportarFalha("observador-mercado", String(err));
    return NextResponse.json({ erro: "Erro no observador de mercado", detalhes: String(err) }, { status: 500 });
  }
}
