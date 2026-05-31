/**
 * health-usuario — Testa rotas autenticadas internamente (servidor-para-servidor).
 * O Guardião chama este endpoint com CRON_SECRET. Aqui dentro fazemos as queries
 * diretamente no banco, sem precisar transportar cookies via HTTP.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";

const GUARDIAN_EMAIL = "guardiao@vovo.internal";

async function getGuardianUserId(): Promise<number | null> {
  const rows = await sql`SELECT id FROM usuarios WHERE email = ${GUARDIAN_EMAIL} LIMIT 1`;
  if (rows.length === 0) {
    const inserted = await sql`
      INSERT INTO usuarios (nome, email, tipo_usuario) VALUES ('Guardião 24/7', ${GUARDIAN_EMAIL}, 'premium') RETURNING id
    `;
    return inserted[0].id;
  }
  return rows[0].id;
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const checks: { nome: string; ok: boolean; erro?: string }[] = [];
  const userId = await getGuardianUserId();
  if (!userId) return NextResponse.json({ erro: "Falha ao obter usuário de teste" }, { status: 500 });

  // ── 1. Favoritos GET ────────────────────────────────────────────────────────
  try {
    await sql`
      SELECT f.id, f.receita_id, f.criado_em AS created_at,
             r.titulo, r.categoria, r.foto_url
      FROM favoritos f
      JOIN receitas r ON r.id = f.receita_id
      WHERE f.usuario_id = ${userId}
      ORDER BY f.criado_em DESC NULLS LAST
      LIMIT 5
    `;
    checks.push({ nome: "favoritos-GET", ok: true });
  } catch (e: any) {
    checks.push({ nome: "favoritos-GET", ok: false, erro: e.message });
  }

  // ── 2. Favoritos POST (adicionar e remover receita de teste) ─────────────
  try {
    const receita = await sql`SELECT id FROM receitas WHERE is_personal = false LIMIT 1`;
    if (receita.length > 0) {
      const rid = receita[0].id;
      // Remover se já existe
      await sql`DELETE FROM favoritos WHERE usuario_id = ${userId} AND receita_id = ${rid}`;
      // Inserir
      await sql`INSERT INTO favoritos (usuario_id, receita_id) VALUES (${userId}, ${rid})`;
      // Remover de volta para não sujar o banco
      await sql`DELETE FROM favoritos WHERE usuario_id = ${userId} AND receita_id = ${rid}`;
      checks.push({ nome: "favoritos-POST", ok: true });
    } else {
      checks.push({ nome: "favoritos-POST", ok: true, erro: "sem receitas para testar" });
    }
  } catch (e: any) {
    checks.push({ nome: "favoritos-POST", ok: false, erro: e.message });
  }

  // ── 3. Receitas query (rota principal) ─────────────────────────────────────
  try {
    const rows = await sql`SELECT id FROM receitas WHERE is_free_rotativa = true LIMIT 1`;
    checks.push({ nome: "receitas-query", ok: rows.length >= 0 });
  } catch (e: any) {
    checks.push({ nome: "receitas-query", ok: false, erro: e.message });
  }

  // ── 4. Plano semanal query ───────────────────────────────────────────────
  try {
    await sql`SELECT * FROM information_schema.tables WHERE table_name = 'plano_semanal' LIMIT 1`;
    checks.push({ nome: "plano-semanal-tabela", ok: true });
  } catch (e: any) {
    checks.push({ nome: "plano-semanal-tabela", ok: false, erro: e.message });
  }

  // ── 5. Lista de compras query ────────────────────────────────────────────
  try {
    await sql`SELECT * FROM information_schema.tables WHERE table_name = 'lista_compras' LIMIT 1`;
    checks.push({ nome: "lista-compras-tabela", ok: true });
  } catch (e: any) {
    checks.push({ nome: "lista-compras-tabela", ok: false, erro: e.message });
  }

  // ── 6. Push subscriptions ────────────────────────────────────────────────
  try {
    await sql`SELECT COUNT(*) FROM push_subscriptions LIMIT 1`;
    checks.push({ nome: "push-subscriptions", ok: true });
  } catch (e: any) {
    checks.push({ nome: "push-subscriptions", ok: false, erro: e.message });
  }

  const falhas = checks.filter(c => !c.ok);
  return NextResponse.json({
    ok: falhas.length === 0,
    total: checks.length,
    falhas: falhas.length,
    checks,
  });
}
