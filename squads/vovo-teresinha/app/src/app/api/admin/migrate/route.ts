import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  const session = await getSession();
  if (!session || session.tipo_usuario !== "admin") {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
  }

  try {
    const [colInfo, sample, tagStats] = await Promise.all([
      sql`
        SELECT column_name, data_type, udt_name
        FROM information_schema.columns
        WHERE table_name = 'receitas' AND column_name = 'tags_restricao'
      `,
      sql`
        SELECT id, titulo, tags_restricao
        FROM receitas
        ORDER BY id DESC
        LIMIT 10
      `,
      sql`
        SELECT
          COUNT(*) FILTER (WHERE tags_restricao::text ILIKE '%vegano%') as tag_vegano,
          COUNT(*) FILTER (WHERE tags_restricao::text ILIKE '%vegetariano%') as tag_vegetariano,
          COUNT(*) FILTER (WHERE tags_restricao IS NULL OR tags_restricao::text = '{}' OR tags_restricao::text = '') as sem_tags,
          COUNT(*) as total
        FROM receitas
      `,
    ]);

    return NextResponse.json({ colInfo, sample, tagStats });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getSession();
  if (!session || session.tipo_usuario !== "admin") {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
  }

  const body = await req.json();
  const { key, action } = body;

  // tag_receitas action only needs admin session (already verified above)
  if (action !== "tag_receitas" && key !== process.env.JWT_SECRET) {
    return NextResponse.json({ erro: "Chave inválida" }, { status: 403 });
  }

  try {
    // action=tag_receitas: auto-tag vegano/vegetariano by ingredient analysis
    if (action === "tag_receitas") {
      // PostgreSQL regex patterns (case-insensitive ~*) — no user input, entirely hardcoded
      const carneRegex = "frango|\\mcarne\\M|\\mpeixe\\M|\\matum\\M|camarão|salmão|bacalhau|linguiça|bacon|presunto|salsicha|costela|lombo|\\mbife\\M|\\mfilé\\M|pernil|alcatra|patinho|picanha|sardinha|tilápia|corvina|anchova|carne moída|frutos do mar";
      const laticiniosRegex = "\\movos?\\M|\\mleite\\M|queijo|iogurte|manteiga|creme de leite|\\bnata\\b|ghee|cream cheese|ricota|cottage|\\mmel\\M|\\mclara\\M|\\mgema\\M|requeijão|\\mwhey\\M";

      // 1. Mark vegetariano: no meat in ingredients
      const vegResult = await sql`
        UPDATE receitas
        SET tags_restricao = ARRAY(
          SELECT DISTINCT unnest(COALESCE(tags_restricao, '{}') || ARRAY['vegetariano']::text[])
        )
        WHERE NOT COALESCE(ingredientes, '') ~* ${carneRegex}
          AND NOT (tags_restricao::text ILIKE '%vegetariano%')
        RETURNING id
      `;

      // 2. Mark vegano: no meat AND no dairy/eggs
      const veganResult = await sql`
        UPDATE receitas
        SET tags_restricao = ARRAY(
          SELECT DISTINCT unnest(COALESCE(tags_restricao, '{}') || ARRAY['vegano', 'vegetariano']::text[])
        )
        WHERE NOT COALESCE(ingredientes, '') ~* ${carneRegex}
          AND NOT COALESCE(ingredientes, '') ~* ${laticiniosRegex}
          AND NOT (tags_restricao::text ILIKE '%vegano%')
        RETURNING id
      `;

      return NextResponse.json({
        dados: {
          vegetariano_tagged: vegResult.length,
          vegano_tagged: veganResult.length,
          message: "Auto-tagging concluído!",
        },
      });
    }

    // Default: schema migrations
    await sql`
      CREATE TABLE IF NOT EXISTS avaliacoes_receitas (
        id SERIAL PRIMARY KEY,
        usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
        receita_id INTEGER NOT NULL REFERENCES receitas(id) ON DELETE CASCADE,
        nota INTEGER NOT NULL CHECK (nota >= 1 AND nota <= 5),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(usuario_id, receita_id)
      )
    `;
    await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS avaliacao_media NUMERIC(3,2) DEFAULT 0`;
    await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS avaliacao_count INTEGER DEFAULT 0`;

    // usuarios — colunas adicionadas progressivamente
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS whatsapp TEXT`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aceita_whatsapp BOOLEAN DEFAULT false`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS plano TEXT`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_inicio TIMESTAMPTZ`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_fim TIMESTAMPTZ`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS assinatura_id TEXT`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT`;

    return NextResponse.json({ dados: { ok: true, message: "Migration completed" } });
  } catch (err) {
    console.error("migration error", err);
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
