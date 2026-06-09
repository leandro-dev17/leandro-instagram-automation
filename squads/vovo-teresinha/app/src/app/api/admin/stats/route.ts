import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeCount(query: Promise<any[]>, fallback = 0): Promise<number> {
  try { return parseInt((await query)[0]?.count ?? String(fallback)); } catch { return fallback; }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function safeSum(query: Promise<any[]>, fallback = 0): Promise<number> {
  try { return parseFloat((await query)[0]?.total ?? String(fallback)); } catch { return fallback; }
}

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    const [totalUsuarios, usuariosPorTipo, totalReceitas, assinaturasAtivas, pushTotal] =
      await Promise.all([
        safeCount(sql`SELECT COUNT(*) as count FROM usuarios`),
        sql`SELECT tipo_usuario, COUNT(*) as count FROM usuarios GROUP BY tipo_usuario`.catch(() => []),
        safeCount(sql`SELECT COUNT(*) as count FROM receitas`),
        safeCount(sql`SELECT COUNT(*) as count FROM assinaturas WHERE status IN ('active','ativo')`),
        safeCount(sql`SELECT COUNT(*) as count FROM push_subscriptions`),
      ]);

    // Queries com colunas que podem ter nome diferente — fallback seguro
    const novosUsuarios7d = await safeCount(
      sql`SELECT COUNT(*) as count FROM usuarios WHERE criada_em >= NOW() - INTERVAL '7 days'`
        .catch(() => sql`SELECT COUNT(*) as count FROM usuarios WHERE created_at >= NOW() - INTERVAL '7 days'`)
    );

    const receita30d = await safeSum(
      sql`SELECT COALESCE(SUM(valor),0) as total FROM assinaturas WHERE status IN ('active','ativo') AND created_at >= NOW() - INTERVAL '30 days'`
        .catch(() => sql`SELECT COALESCE(SUM(valor),0) as total FROM assinaturas WHERE status IN ('active','ativo')`)
    );

    const receitasLivres = await safeCount(
      sql`SELECT COUNT(*) as count FROM receitas WHERE is_free_rotativa = true`
    );

    return NextResponse.json({
      dados: {
        total_usuarios: totalUsuarios,
        usuarios_por_tipo: usuariosPorTipo,
        total_receitas: totalReceitas,
        receitas_livres: receitasLivres,
        assinaturas_ativas: assinaturasAtivas,
        receita_total_30d: receita30d,
        novos_usuarios_7d: novosUsuarios7d,
        push_subscriptions: pushTotal,
      },
    });
  } catch (err) {
    console.error("admin/stats error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
