export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    try {
      const { sql } = await import("./lib/db");

      // Ratings table
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

      // New recipe columns
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS avaliacao_media NUMERIC(3,2) DEFAULT 0`;
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS avaliacao_count INTEGER DEFAULT 0`;
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS dica_vovo TEXT`;
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS proteina NUMERIC(6,2)`;
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS carboidratos NUMERIC(6,2)`;
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS gordura NUMERIC(6,2)`;
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS fibras NUMERIC(6,2)`;

      // Push subscriptions
      await sql`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          endpoint TEXT NOT NULL UNIQUE,
          p256dh TEXT NOT NULL,
          auth TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      // Lista de compras
      await sql`
        CREATE TABLE IF NOT EXISTS lista_compras (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          item TEXT NOT NULL,
          checked BOOLEAN DEFAULT false,
          receita_id INTEGER REFERENCES receitas(id) ON DELETE SET NULL,
          receita_titulo TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;
      await sql`ALTER TABLE lista_compras ADD COLUMN IF NOT EXISTS receita_id INTEGER REFERENCES receitas(id) ON DELETE SET NULL`;
      await sql`ALTER TABLE lista_compras ADD COLUMN IF NOT EXISTS receita_titulo TEXT`;

      // App settings table
      await sql`
        CREATE TABLE IF NOT EXISTS app_configuracoes (
          chave TEXT PRIMARY KEY,
          valor TEXT NOT NULL,
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
      `;

      // Google OAuth
      await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS google_id TEXT`;
      await sql`CREATE UNIQUE INDEX IF NOT EXISTS usuarios_google_id_key ON usuarios(google_id) WHERE google_id IS NOT NULL`;

      // Assinaturas recorrentes (PreApproval)
      await sql`ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS mp_preapproval_id TEXT`;
      await sql`ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS renovada_em TIMESTAMPTZ`;
      await sql`
        CREATE UNIQUE INDEX IF NOT EXISTS assinaturas_preapproval_unique
        ON assinaturas(mp_preapproval_id)
        WHERE mp_preapproval_id IS NOT NULL
      `;

      // Refeição nas receitas (para filtro de momento do dia)
      await sql`ALTER TABLE receitas ADD COLUMN IF NOT EXISTS refeicao TEXT`;

      // Plano semanal
      await sql`
        CREATE TABLE IF NOT EXISTS planos_semanais (
          id SERIAL PRIMARY KEY,
          usuario_id INTEGER NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
          semana DATE NOT NULL,
          slot TEXT NOT NULL,
          receita_id INTEGER REFERENCES receitas(id) ON DELETE SET NULL,
          UNIQUE(usuario_id, semana, slot)
        )
      `;
    } catch (err) {
      console.error("[instrumentation] migration error:", err);
    }
  }
}
