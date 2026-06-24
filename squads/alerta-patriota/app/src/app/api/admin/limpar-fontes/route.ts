import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";

// Marca notícias de fontes generalistas como publicadas para limpar o backlog
// GET /api/admin/limpar-fontes
const FONTES_EXCLUIR = ['metrópoles', 'metropoles', 'uol', 'r7', 'terra'];

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    let totalMarcadas = 0;

    for (const fonte of FONTES_EXCLUIR) {
      const result = await sql`
        UPDATE noticias
        SET postada_vip = true,
            postada_elite = true,
            postada_vip_at = COALESCE(postada_vip_at, NOW()),
            postada_elite_at = COALESCE(postada_elite_at, NOW())
        WHERE LOWER(fonte) LIKE ${'%' + fonte + '%'}
          AND (postada_vip = false OR postada_elite = false)
      `;
      totalMarcadas += result.length || 0;
    }

    return NextResponse.json({ ok: true, marcadas: totalMarcadas, fontes: FONTES_EXCLUIR });
  } catch (err) {
    // FASE 24: mesma proteção já aplicada a 7 outras rotas admin nas Fases 23/24.
    console.error("admin/limpar-fontes error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
