/**
 * CURADOR CARLOS AVALIAÇÕES — Curador de Avaliações de Receitas
 * Monitora avaliações (favoritos + engajamento) para identificar receitas mais/menos populares.
 * Sinaliza receitas sem engajamento para possível substituição.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Top 5 receitas mais favoritadas
    const topFavoritas = await sql`
      SELECT r.id, r.titulo, r.categoria, COUNT(f.id)::int AS total_favoritos
      FROM receitas r
      JOIN favoritos f ON f.receita_id = r.id
      GROUP BY r.id, r.titulo, r.categoria
      ORDER BY total_favoritos DESC
      LIMIT 5
    ` as { id: number; titulo: string; categoria: string; total_favoritos: number }[];

    // Receitas sem nenhum favorito (criadas há mais de 30 dias)
    const semEngajamento = await sql`
      SELECT r.id, r.titulo, r.categoria
      FROM receitas r
      WHERE r.created_at < NOW() - INTERVAL '30 days'
        AND NOT EXISTS (SELECT 1 FROM favoritos f WHERE f.receita_id = r.id)
      ORDER BY r.created_at ASC
      LIMIT 10
    ` as { id: number; titulo: string; categoria: string }[];

    // Categorias mais populares
    const categorias = await sql`
      SELECT r.categoria, COUNT(DISTINCT f.usuario_id)::int AS usuarios_unicos
      FROM favoritos f
      JOIN receitas r ON r.id = f.receita_id
      GROUP BY r.categoria
      ORDER BY usuarios_unicos DESC
      LIMIT 5
    ` as { categoria: string; usuarios_unicos: number }[];

    // Total de interações com favoritos esta semana
    const [semana] = await sql`
      SELECT COUNT(*)::int AS total FROM favoritos
      WHERE criado_em > NOW() - INTERVAL '7 days'
    `;

    const linhas = [
      `⭐ <b>Curador Avaliações — Relatório Semanal</b>`,
      ``,
      `<b>🏆 Top 5 Receitas Favoritas:</b>`,
      ...topFavoritas.map((r, i) => `  ${i + 1}. ${r.titulo} (${r.total_favoritos} ❤️)`),
      ``,
      `<b>📊 Categorias mais amadas:</b>`,
      ...categorias.map(c => `  • ${c.categoria}: ${c.usuarios_unicos} usuários`),
      ``,
      `<b>💜 Favoritos esta semana:</b> ${semana.total}`,
    ];

    if (semEngajamento.length > 0) {
      linhas.push(``, `<b>⚠️ Receitas sem engajamento (30d+):</b>`);
      linhas.push(...semEngajamento.slice(0, 5).map(r => `  • ${r.titulo} (${r.categoria})`));
      if (semEngajamento.length > 5) {
        linhas.push(`  ... e mais ${semEngajamento.length - 5} receita(s)`);
      }
      linhas.push(`\n<i>Considere substituir estas receitas por novas opções!</i>`);
    }

    await enviarTelegram(linhas.join("\n"));
    await resolverFalhas("curador-avaliacoes");

    return NextResponse.json({
      ok: true,
      top_favoritas: topFavoritas,
      sem_engajamento: semEngajamento.length,
      favoritos_semana: semana.total,
    });
  } catch (err) {
    await reportarFalha("curador-avaliacoes", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
