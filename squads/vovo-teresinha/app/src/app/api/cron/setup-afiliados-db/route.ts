import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";

// One-time setup: cria/migra tabelas do sistema de afiliados
export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const log: string[] = [];

  try {
    // Tabela principal de afiliados (cria esqueleto se não existir)
    await sql`
      CREATE TABLE IF NOT EXISTS afiliados (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(200) NOT NULL,
        email VARCHAR(200) UNIQUE NOT NULL,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `;
    log.push("tabela afiliados: ok");

    // Adiciona colunas faltantes individualmente (idempotente)
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS nome VARCHAR(200)`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS email VARCHAR(200)`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS usuario_id INTEGER REFERENCES usuarios(id) ON DELETE CASCADE`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS telefone VARCHAR(30)`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS codigo_afiliado VARCHAR(20)`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'ativo'`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS taxa_comissao NUMERIC(5,2) DEFAULT 20.00`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS total_indicacoes INTEGER DEFAULT 0`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS total_conversoes INTEGER DEFAULT 0`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS total_comissao_gerada NUMERIC(10,2) DEFAULT 0`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS total_comissao_paga NUMERIC(10,2) DEFAULT 0`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS atualizado_em TIMESTAMP DEFAULT NOW()`; } catch { /* ignorado */ }
    log.push("colunas afiliados: ok");

    // Gera código para afiliados sem código (usa id já que nome pode ser null)
    await sql`
      UPDATE afiliados
      SET codigo_afiliado = 'afil' || UPPER(SUBSTRING(MD5(id::text), 1, 8))
      WHERE codigo_afiliado IS NULL
    `;

    // Constraint UNIQUE para codigo_afiliado
    try {
      await sql`ALTER TABLE afiliados ADD CONSTRAINT afiliados_codigo_unique UNIQUE (codigo_afiliado)`;
      log.push("constraint unique codigo: criada");
    } catch { log.push("constraint unique codigo: já existe"); }

    // Tabela de rastreamento de links
    await sql`
      CREATE TABLE IF NOT EXISTS rastreamento_links (
        id SERIAL PRIMARY KEY,
        afiliado_id INTEGER REFERENCES afiliados(id) ON DELETE CASCADE,
        codigo_afiliado VARCHAR(20) NOT NULL,
        ip_visitante VARCHAR(50),
        user_agent TEXT,
        pagina_destino VARCHAR(200) DEFAULT '/',
        converteu BOOLEAN DEFAULT FALSE,
        usuario_convertido_id INTEGER REFERENCES usuarios(id) ON DELETE SET NULL,
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `;
    log.push("tabela rastreamento_links: ok");

    // Tabela de comissões (pode já existir com schema diferente — só adicionamos colunas)
    await sql`
      CREATE TABLE IF NOT EXISTS comissoes (
        id SERIAL PRIMARY KEY,
        afiliado_id INTEGER,
        status VARCHAR(20) DEFAULT 'pendente',
        criado_em TIMESTAMP DEFAULT NOW()
      )
    `;
    // Colunas extras (idempotente)
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS rastreamento_id INTEGER REFERENCES rastreamento_links(id) ON DELETE SET NULL`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS assinatura_id INTEGER REFERENCES assinaturas(id) ON DELETE SET NULL`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS usuario_id INTEGER`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS valor_assinatura NUMERIC(10,2)`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS taxa_comissao NUMERIC(5,2) DEFAULT 20.00`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS valor_comissao NUMERIC(10,2)`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS valor NUMERIC(10,2)`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS pago_em TIMESTAMP`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS liberado_em TIMESTAMP`; } catch { /* ignorado */ }
    try { await sql`ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS criado_em TIMESTAMP DEFAULT NOW()`; } catch { /* ignorado */ }
    log.push("tabela comissoes: ok");

    // Índices
    try { await sql`CREATE INDEX IF NOT EXISTS idx_rastreamento_afiliado ON rastreamento_links(afiliado_id)`; } catch { /* ignorado */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_rastreamento_codigo ON rastreamento_links(codigo_afiliado)`; } catch { /* ignorado */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_comissoes_afiliado ON comissoes(afiliado_id)`; } catch { /* ignorado */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_comissoes_status ON comissoes(status)`; } catch { /* ignorado */ }
    try { await sql`CREATE INDEX IF NOT EXISTS idx_afiliados_codigo ON afiliados(codigo_afiliado)`; } catch { /* ignorado */ }
    log.push("índices: ok");

    return NextResponse.json({ ok: true, log });
  } catch (err) {
    return NextResponse.json({ erro: String(err), log }, { status: 500 });
  }
}
