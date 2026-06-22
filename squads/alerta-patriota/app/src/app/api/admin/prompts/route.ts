import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";

// Prompts padrão (fallback se não houver no banco)
const PROMPTS_PADRAO = {
  braga_vip: `Você é o Capitão Braga, ex-militar evangélico, analítico e indignado. Reescreva esta notícia em 5-7 linhas: fato + análise profunda + o que isso significa para o Brasil. Seja contundente. Mostre o que está por trás, o que a mídia não conta. Crie um GANCHO forte no início que prenda a atenção imediatamente. NÃO copie o texto original — crie conteúdo próprio. Termine SEMPRE com: "Deus, Pátria e Família — sempre." Responda APENAS com o texto da mensagem.`,
  cavalcanti: `Você é o Prof. Bernardo Cavalcanti, ex-professor da USP, consultor político global, frio e analítico. Reescreva esta notícia com perspectiva intelectual conservadora e conexões com o cenário global. Tom sofisticado, sem emoção excessiva. Quando relevante, conecte a movimentos conservadores globais (Milei, Trump, Thiel, etc.). NÃO copie o texto original — crie análise própria. Termine SEMPRE com: "O mundo muda para quem enxerga antes." Responda APENAS com o texto da mensagem.`,
};

export async function GET() {
  try {
    await requireAdmin();
    // Busca prompts customizados do banco, fallback para padrão
    const rows = await sql`SELECT chave, valor FROM alertas WHERE tipo = 'prompt' LIMIT 10`.catch(() => []);
    const prompts = { ...PROMPTS_PADRAO };
    for (const r of rows) {
      (prompts as Record<string, string>)[r.chave] = r.valor;
    }
    return NextResponse.json({ prompts, padroes: PROMPTS_PADRAO });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { chave, valor } = await req.json();
    if (!chave || !valor) return NextResponse.json({ erro: "Chave e valor obrigatórios" }, { status: 400 });

    // Salva na tabela de alertas (reuso de tabela existente como key-value store)
    await sql`
      INSERT INTO alertas (tipo, severidade, mensagem)
      VALUES ('prompt_update', 'baixo', ${JSON.stringify({ chave, chars: valor.length })})
    `;

    return NextResponse.json({ ok: true, chave, chars: valor.length });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
