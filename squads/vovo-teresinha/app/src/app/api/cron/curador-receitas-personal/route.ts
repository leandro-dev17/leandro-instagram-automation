import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

// 9 receitas/semana para alunas do personal: 3 café, 3 lanches, 3 sobremesas
// Filtros: qualquer tag saudável (sem_gluten | sem_lactose | low_carb), ≤300 kcal, ≤20 min
// Sem repetição nas últimas 4 semanas

async function candidatas(categoria: string, excluir: number[]): Promise<{ id: number; titulo: string }[]> {
  const rows = await sql`
    SELECT id, titulo FROM receitas
    WHERE categoria = ${categoria}
      AND (calorias IS NULL OR calorias <= 300)
      AND (tempo_preparo IS NULL OR tempo_preparo <= 20)
      AND (
        'sem_gluten'  = ANY(tags_restricao) OR
        'sem_lactose' = ANY(tags_restricao) OR
        'low_carb'    = ANY(tags_restricao)
      )
    ORDER BY RANDOM()
    LIMIT 20
  `;
  return rows
    .filter((r: { id: number }) => !excluir.includes(r.id))
    .slice(0, 3) as { id: number; titulo: string }[];
}

async function candidatasSemFiltro(categoria: string, excluir: number[], limite: number): Promise<{ id: number; titulo: string }[]> {
  const rows = await sql`
    SELECT id, titulo FROM receitas
    WHERE categoria = ${categoria}
    ORDER BY RANDOM()
    LIMIT 20
  `;
  return rows
    .filter((r: { id: number }) => !excluir.includes(r.id))
    .slice(0, limite) as { id: number; titulo: string }[];
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // IDs usados nas últimas 4 semanas (evitar repetição)
    const historico = await sql`
      SELECT valor FROM app_configuracoes
      WHERE chave LIKE 'personal_semana_%'
      ORDER BY chave DESC
      LIMIT 4
    `.catch(() => [] as { valor: string }[]);

    const idsUsados: number[] = [];
    for (const row of historico) {
      try { idsUsados.push(...JSON.parse(row.valor)); } catch { /* ignore */ }
    }

    // Buscar 3 por período
    let manha      = await candidatas("cafe_manha", idsUsados);
    let lanches    = await candidatas("lanches_snacks", idsUsados);
    let sobremesas = await candidatas("doces_sobremesas", idsUsados);

    // Fallback sem filtro de tags se não atingir 3
    if (manha.length < 3)
      manha = [...manha, ...await candidatasSemFiltro("cafe_manha", idsUsados, 3 - manha.length)];
    if (lanches.length < 3)
      lanches = [...lanches, ...await candidatasSemFiltro("lanches_snacks", idsUsados, 3 - lanches.length)];
    if (sobremesas.length < 3)
      sobremesas = [...sobremesas, ...await candidatasSemFiltro("doces_sobremesas", idsUsados, 3 - sobremesas.length)];

    const selecionados = [...manha, ...lanches, ...sobremesas];
    const ids = selecionados.map(r => r.id);

    // Salvar seleção da semana
    const chave = `personal_semana_${new Date().toISOString().slice(0, 10)}`;
    await sql`
      INSERT INTO app_configuracoes (chave, valor)
      VALUES (${chave}, ${JSON.stringify(ids)})
      ON CONFLICT (chave) DO UPDATE SET valor = ${JSON.stringify(ids)}
    `;

    const linhas = [
      `☀️ Café da manhã: ${manha.map(r => r.titulo).join(", ") || "—"}`,
      `🥗 Lanches: ${lanches.map(r => r.titulo).join(", ") || "—"}`,
      `🍮 Sobremesas: ${sobremesas.map(r => r.titulo).join(", ") || "—"}`,
    ].join("\n");

    await enviarTelegram(
      `📋 <b>Curador Personal — Semana de ${new Date().toLocaleDateString("pt-BR")}</b>\n\n` +
      `${linhas}\n\n` +
      `<i>Filtro: sem_gluten/sem_lactose/low_carb · ≤300kcal · ≤20min · sem repetição 4 semanas</i>`
    );

    await resolverFalhas("curador-receitas-personal");
    return NextResponse.json({ ok: true, total: selecionados.length, ids });
  } catch (err) {
    await reportarFalha("curador-receitas-personal", String(err));
    return NextResponse.json({ erro: "Erro no curador personal", detalhes: String(err) }, { status: 500 });
  }
}
