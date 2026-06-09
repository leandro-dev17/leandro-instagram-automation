import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safe<T>(query: Promise<T>, fallback: T): Promise<T> {
  try { return await query; } catch { return fallback; }
}

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const { searchParams } = new URL(req.url);
    const periodo = Math.min(365, Math.max(1, parseInt(searchParams.get("periodo") || "30")));

    // Assinantes premium direto da tabela usuarios (fonte mais confiável)
    const assinantes = await sql`
      SELECT id, nome, email, whatsapp, plano, trial_fim, tipo_usuario
      FROM usuarios
      WHERE tipo_usuario IN ('premium', 'aluna_leandro')
      ORDER BY id DESC
    `;

    // Tentar buscar dados financeiros da tabela assinaturas com fallbacks
    const receitaTotal = await safe(
      sql`SELECT COALESCE(SUM(valor),0) as total FROM assinaturas
          WHERE status IN ('ativo','active','approved')
          AND created_at >= NOW() - INTERVAL '1 day' * ${periodo}`.then(r => parseFloat(r[0]?.total ?? "0")),
      0
    ).catch(() =>
      safe(
        sql`SELECT COALESCE(SUM(valor),0) as total FROM assinaturas
            WHERE status IN ('ativo','active','approved')
            AND criada_em >= NOW() - INTERVAL '1 day' * ${periodo}`.then(r => parseFloat(r[0]?.total ?? "0")),
        0
      )
    );

    const pagamentos = await safe(
      sql`SELECT COUNT(*) as count FROM assinaturas
          WHERE status IN ('ativo','active','approved')
          AND created_at >= NOW() - INTERVAL '1 day' * ${periodo}`.then(r => parseInt(r[0]?.count ?? "0")),
      0
    ).catch(() => 0);

    const assinaturasPorPlano = await safe(
      sql`SELECT plano, COUNT(*) as count, COALESCE(SUM(valor),0) as total
          FROM assinaturas WHERE status IN ('ativo','active','approved') GROUP BY plano`,
      [] as Record<string, unknown>[]
    ).catch(() => []);

    return NextResponse.json({
      dados: {
        receita_periodo: await receitaTotal,
        pagamentos_periodo: pagamentos,
        assinaturas_por_plano: assinaturasPorPlano,
        total_assinantes: assinantes.length,
        assinantes,
      },
    });
  } catch (err) {
    console.error("admin/financeiro error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
