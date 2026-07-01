import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

const META = 80;

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Zera todas as rotativas
    await sql`UPDATE receitas SET is_free_rotativa = false`;

    // Busca categorias distintas
    const categorias = await sql`
      SELECT DISTINCT categoria FROM receitas
      WHERE categoria IS NOT NULL AND categoria != ''
      ORDER BY categoria
    `;
    const cats = categorias.map((r) => r.categoria as string);

    if (cats.length === 0) {
      return NextResponse.json({ ok: true, total: 0, motivo: "sem categorias" });
    }

    // Distribui os 40 slots proporcionalmente entre categorias
    const slotsBase = Math.floor(META / cats.length);
    const extras = META % cats.length;
    const selecionadas: number[] = [];

    for (let i = 0; i < cats.length; i++) {
      const slots = slotsBase + (i < extras ? 1 : 0);
      if (slots === 0) continue;
      const rows = await sql`
        SELECT id FROM receitas
        WHERE categoria = ${cats[i]}
        ORDER BY RANDOM()
        LIMIT ${slots}
      `;
      selecionadas.push(...rows.map((r) => r.id as number));
    }

    if (selecionadas.length > 0) {
      await sql`
        UPDATE receitas SET is_free_rotativa = true
        WHERE id = ANY(${selecionadas})
      `;
    }

    const data = new Date().toLocaleDateString("pt-BR");
    const msg =
      `🔄 <b>Rotação de Receitas Free — ${data}</b>\n\n` +
      `✅ <b>${selecionadas.length} receitas</b> selecionadas para o mês\n` +
      `📂 Categorias: ${cats.length} (${cats.join(", ")})\n` +
      `📊 Distribuição: ~${slotsBase} por categoria\n\n` +
      `<i>Próxima rotação: 1º do próximo mês</i>`;

    await enviarTelegram(msg);

    return NextResponse.json({ ok: true, total: selecionadas.length, categorias: cats.length });
  } catch (err) {
    console.error("rotacao-receitas-free error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
