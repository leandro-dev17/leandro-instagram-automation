import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";

// Rota protegida — só executa com CRON_SECRET correto
// POST /api/admin/setup — cria todas as tabelas do zero

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // ── USUÁRIOS ────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS usuarios (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        senha_hash VARCHAR(255) NOT NULL,
        telefone VARCHAR(20),
        plano VARCHAR(20),
        status VARCHAR(20) DEFAULT 'trial',
        tipo_usuario VARCHAR(20) DEFAULT 'membro',
        mp_subscription_id VARCHAR(100),
        mp_customer_id VARCHAR(100),
        trial_inicio TIMESTAMP,
        trial_fim TIMESTAMP,
        assinatura_inicio TIMESTAMP,
        assinatura_fim TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── ASSINATURAS ─────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS assinaturas (
        id SERIAL PRIMARY KEY,
        usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
        plano VARCHAR(20) NOT NULL,
        valor DECIMAL(10,2) NOT NULL,
        ciclo VARCHAR(10) NOT NULL DEFAULT 'mensal',
        status VARCHAR(20) DEFAULT 'ativa',
        mp_subscription_id VARCHAR(100) UNIQUE,
        renovada_em TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── PAGAMENTOS ──────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS pagamentos (
        id SERIAL PRIMARY KEY,
        assinatura_id INT REFERENCES assinaturas(id),
        usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
        valor DECIMAL(10,2) NOT NULL,
        status VARCHAR(20) NOT NULL,
        mp_payment_id VARCHAR(100) UNIQUE,
        metodo VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── GRUPOS WHATSAPP ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS grupos_whatsapp (
        id SERIAL PRIMARY KEY,
        nome VARCHAR(100) NOT NULL,
        plano VARCHAR(20) NOT NULL UNIQUE,
        link_convite TEXT,
        group_id_wa VARCHAR(100),
        max_membros INT DEFAULT 1000,
        membros_ativos INT DEFAULT 0,
        ativo BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── MEMBROS DOS GRUPOS ──────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS membros_grupos (
        id SERIAL PRIMARY KEY,
        usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
        grupo_id INT REFERENCES grupos_whatsapp(id),
        data_entrada TIMESTAMP DEFAULT NOW(),
        data_saida TIMESTAMP,
        status VARCHAR(20) DEFAULT 'ativo',
        UNIQUE(usuario_id, grupo_id)
      )
    `;

    // ── NOTÍCIAS ────────────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS noticias (
        id SERIAL PRIMARY KEY,
        titulo TEXT NOT NULL,
        fonte VARCHAR(100) NOT NULL,
        url TEXT,
        conteudo_original TEXT,
        resumo_braga TEXT,
        resumo_cavalcanti TEXT,
        categoria VARCHAR(50),
        urgente BOOLEAN DEFAULT false,
        global BOOLEAN DEFAULT false,
        postada_vip BOOLEAN DEFAULT false,
        postada_elite BOOLEAN DEFAULT false,
        postada_vip_at TIMESTAMP,
        postada_elite_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── POSTS WHATSAPP ──────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS posts_whatsapp (
        id SERIAL PRIMARY KEY,
        grupo_id INT REFERENCES grupos_whatsapp(id),
        noticia_id INT REFERENCES noticias(id),
        conteudo TEXT NOT NULL,
        tipo VARCHAR(30) NOT NULL,
        status VARCHAR(20) DEFAULT 'enviado',
        enviado_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── LISTA DE ESPERA ─────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS lista_espera (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255) NOT NULL,
        telefone VARCHAR(20),
        plano_desejado VARCHAR(20),
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── LINKS DE COMPARTILHAMENTO ───────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS links_compartilhamento (
        id SERIAL PRIMARY KEY,
        usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
        noticia_id INT REFERENCES noticias(id),
        token VARCHAR(100) UNIQUE NOT NULL,
        cliques INT DEFAULT 0,
        conversoes INT DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── TERMÔMETRO DA LIBERDADE ─────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS termometro (
        id SERIAL PRIMARY KEY,
        semana INT NOT NULL,
        ano INT NOT NULL,
        democracia INT NOT NULL,
        economia INT NOT NULL,
        seguranca INT NOT NULL,
        soberania INT NOT NULL,
        analise TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        UNIQUE(semana, ano)
      )
    `;

    // ── LOGS DOS AGENTES ────────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS agentes_log (
        id SERIAL PRIMARY KEY,
        agente VARCHAR(100) NOT NULL,
        acao TEXT NOT NULL,
        status VARCHAR(20) NOT NULL,
        detalhes JSONB,
        duracao_ms INT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── ALERTAS DO SISTEMA ──────────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS alertas (
        id SERIAL PRIMARY KEY,
        tipo VARCHAR(50) NOT NULL,
        severidade VARCHAR(20) NOT NULL DEFAULT 'medio',
        mensagem TEXT NOT NULL,
        resolvido BOOLEAN DEFAULT false,
        resolvido_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── FILA WHATSAPP (retry) ───────────────────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_fila (
        id SERIAL PRIMARY KEY,
        usuario_id INT REFERENCES usuarios(id) ON DELETE CASCADE,
        tipo VARCHAR(50) NOT NULL,
        tentativas INT DEFAULT 0,
        agendado_para TIMESTAMP DEFAULT NOW(),
        processado_em TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── RADAR POLÍTICO (tweets detectados) ─────────────────────────────────
    await sql`
      CREATE TABLE IF NOT EXISTS radar_politico (
        id SERIAL PRIMARY KEY,
        politico VARCHAR(100) NOT NULL,
        tweet_id VARCHAR(100) UNIQUE,
        conteudo TEXT NOT NULL,
        likes INT DEFAULT 0,
        retweets INT DEFAULT 0,
        processado BOOLEAN DEFAULT false,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── CONSUMO DE IA (log de chamadas por agente/provedor para o disjuntor) ──
    await sql`
      CREATE TABLE IF NOT EXISTS consumo_ia_log (
        id SERIAL PRIMARY KEY,
        agente VARCHAR(100) NOT NULL,
        provedor VARCHAR(20) NOT NULL,
        status VARCHAR(20) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // ── GRUPOS PADRÃO ───────────────────────────────────────────────────────
    await sql`
      INSERT INTO grupos_whatsapp (nome, plano, link_convite, group_id_wa)
      VALUES
        ('VIP Premium', 'vip', ${process.env.WPP_LINK_VIP || ''}, ${process.env.WPP_GROUP_VIP || ''}),
        ('Elite Global', 'elite', ${process.env.WPP_LINK_ELITE || ''}, ${process.env.WPP_GROUP_ELITE || ''})
      ON CONFLICT (plano) DO NOTHING
    `;

    return NextResponse.json({ ok: true, mensagem: "Banco de dados criado com sucesso!" });
  } catch (err) {
    console.error("setup/route.ts error:", err);
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
