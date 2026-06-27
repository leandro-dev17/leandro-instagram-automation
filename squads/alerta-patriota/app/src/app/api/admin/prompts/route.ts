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
    // Busca prompts customizados do banco (tabela dedicada), fallback para padrão
    const rows = await sql`SELECT chave, valor FROM prompts_customizados`.catch(() => []);
    const prompts = { ...PROMPTS_PADRAO };
    for (const r of rows) {
      (prompts as Record<string, string>)[String(r.chave)] = String(r.valor);
    }
    return NextResponse.json({ prompts, padroes: PROMPTS_PADRAO });
  } catch (err) {
    console.error("admin/prompts GET error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { chave, valor } = await req.json();
    if (!chave || !valor) return NextResponse.json({ erro: "Chave e valor obrigatórios" }, { status: 400 });
    if (!(chave in PROMPTS_PADRAO)) return NextResponse.json({ erro: "Chave de prompt desconhecida" }, { status: 400 });

    // Salva o texto completo do prompt na tabela dedicada (antes só gravava metadados
    // {chave, chars} em `alertas`, nunca o conteúdo real — ver lib/personas.ts, que é
    // onde resumir-noticias lê o prompt em uso para aplicar este override.
    await sql`
      INSERT INTO prompts_customizados (chave, valor, updated_at)
      VALUES (${chave}, ${valor}, NOW())
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, updated_at = NOW()
    `;

    return NextResponse.json({ ok: true, chave, chars: valor.length });
  } catch (err) {
    console.error("admin/prompts POST error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
