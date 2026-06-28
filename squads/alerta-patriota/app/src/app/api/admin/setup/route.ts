import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";

// Rota protegida — só executa com CRON_SECRET correto
// POST /api/admin/setup — cria todas as tabelas do zero

export async function POST(req: NextRequest) {
  // FASE 24: esta rota faz DDL completo (cria/migra todo o schema) — o maior
  // blast radius do projeto — mas comparava o secret com `!==` puro em vez de
  // compararSegredo()/timingSafeEqual, que corrigiu esse mesmo padrão em
  // verificarCronSecret/verificarSegredoAutofix na Fase 23. Ficou de fora daquela
  // migração porque a comparação aqui era inline, não passava por lib/auth.ts.
  if (!verificarCronSecret(req)) {
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
        updated_at TIMESTAMP DEFAULT NOW(),
        aceite_termos_em TIMESTAMP,
        aceite_termos_ip VARCHAR(64)
      )
    `;
    // FASE 21 (LGPD): colunas adicionadas depois da criação inicial da tabela em produção —
    // ADD COLUMN IF NOT EXISTS garante que ambientes já existentes recebam as novas colunas.
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aceite_termos_em TIMESTAMP`;
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS aceite_termos_ip VARCHAR(64)`;

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
    // FASE 32: produção criou a tabela `pagamentos` antes da coluna assinatura_id
    // existir no CREATE TABLE acima — CREATE TABLE IF NOT EXISTS não adiciona colunas
    // em tabela já existente, então a coluna nunca chegou em produção. Sem ela,
    // idx_pagamentos_assinatura_id (abaixo) falhava com "column does not exist" e
    // abortava todo o restante do script de setup (mesmo padrão de drift já tratado
    // em usuarios/leads/whatsapp_fila neste arquivo).
    await sql`ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS assinatura_id INT REFERENCES assinaturas(id)`;

    // Item 14 (Fase 30): cupons VOLTA10/15/20 não tinham nenhum rastreamento de uso —
    // 1 cupom por conta, registrado aqui (ver src/lib/cupons.ts para elegibilidade).
    await sql`ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS cupom_usado VARCHAR(20)`;
    await sql`ALTER TABLE pagamentos ADD COLUMN IF NOT EXISTS cupom VARCHAR(20)`;
    await sql`ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS cupom VARCHAR(20)`;

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
    // FASE 30: `resumir-noticias-global` usa `ON CONFLICT DO NOTHING` ao salvar o rascunho
    // do Elite, mas sem índice único o Postgres rejeita o INSERT em runtime. Escopo do
    // índice limitado a status='rascunho' (não cobre os INSERTs de 'enviado'/'erro' feitos
    // por publicar-noticias/radar-politico/gerar-card, que legitimamente podem coexistir
    // para o mesmo grupo_id+noticia_id+tipo='noticia' quando a notícia é global).
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS posts_whatsapp_rascunho_unique
      ON posts_whatsapp(grupo_id, noticia_id, tipo) WHERE status = 'rascunho'
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
    // FASE 30: `lista-de-espera/route.ts` usa `ON CONFLICT DO NOTHING` ao inserir, mas
    // sem nenhum índice único sobre `email` o Postgres rejeita o INSERT em runtime
    // ("no unique or exclusion constraint matching ON CONFLICT") — todo cadastro de lead
    // quebrava com erro 500 (confirmado em produção: tabela com 0 linhas).
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS lista_espera_email_unique ON lista_espera(email)`;

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
        mensagem TEXT,
        tentativas INT DEFAULT 0,
        agendado_para TIMESTAMP DEFAULT NOW(),
        processado_em TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    // FASE 23: a coluna mensagem (usada por webhook/whatsapp e bot-responder) faltava na
    // CREATE TABLE original — só existia em bancos onde fix-encoding/revisor-schema já
    // tinham rodado o ALTER TABLE de patch. Um setup do zero ficava sem a coluna.
    await sql`ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS mensagem TEXT`;

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

    // ── LEADS (captura da landing page) ─────────────────────────────────────
    // FASE 21: schema final já com email nullable e colunas de whatsapp — antes essas
    // migrações (CREATE TABLE + 4x ALTER TABLE) rodavam a cada requisição em
    // /api/leads/registrar (rota pública) e a cada execução do cron
    // sequencia-nao-conversao, gerando DDL repetido sem necessidade e lock
    // potencial em rota de tráfego público.
    await sql`
      CREATE TABLE IF NOT EXISTS leads (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email VARCHAR(255) UNIQUE,
        telefone VARCHAR(20),
        nome VARCHAR(255),
        plano_interesse VARCHAR(20),
        origem VARCHAR(50),
        convertido BOOLEAN DEFAULT false,
        ultimo_email_enviado INT DEFAULT 0,
        email_enviado_at TIMESTAMP,
        ultimo_whatsapp_enviado INT DEFAULT 0,
        whatsapp_enviado_at TIMESTAMP,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE leads ALTER COLUMN email DROP NOT NULL`;
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS leads_telefone_unique
      ON leads(telefone) WHERE telefone IS NOT NULL
    `;

    // ── RATE LIMIT (leads/registrar) ────────────────────────────────────────
    // Item 26 (Fase 30): substitui o rate limit em Map de memória do processo,
    // ineficaz em serverless (cada cold start/instância concorrente tem memória
    // isolada). Tabela dedicada para não poluir agentes_log com tentativas.
    await sql`
      CREATE TABLE IF NOT EXISTS leads_rate_limit (
        id SERIAL PRIMARY KEY,
        ip VARCHAR(64) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_leads_rate_limit_ip_created
      ON leads_rate_limit (ip, created_at)
    `;

    // ── PROMPTS CUSTOMIZADOS (editor /admin/prompts) ────────────────────────
    // FASE 27.3: o editor de prompts salvava em `alertas` (tipo='prompt_update') só um
    // JSON de metadados ({chave, chars}), nunca o texto do prompt em si, e o GET lia
    // colunas chave/valor que não existem em `alertas` (sempre falhava, caía no
    // .catch(() => []) e voltava ao padrão hardcoded). Tabela key-value dedicada e real.
    await sql`
      CREATE TABLE IF NOT EXISTS prompts_customizados (
        chave VARCHAR(50) PRIMARY KEY,
        valor TEXT NOT NULL,
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `;

    // FASE 27.6: facebook-comentarios fazia SELECT (já respondido?) e só registrava o
    // comentário em agentes_log DEPOIS de confirmar o envio da resposta — entre o SELECT
    // e o INSERT existia uma janela onde uma segunda execução concorrente (overlap de
    // cron) podia passar pelo mesmo SELECT e responder duplicado ao mesmo comentário.
    // Índice único permite reivindicar o comentário atomicamente (INSERT ... ON CONFLICT)
    // antes de gerar/enviar a resposta, no mesmo espírito do claim de resumir-noticias.
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agentes_log_fb_comentario
      ON agentes_log ((detalhes->>'comentarioId'))
      WHERE agente = 'facebook-comentarios'
    `;

    // FASE 32: fiscal-pipeline.ts (auto-fix do mateus-manchete) checava cooldown via SELECT
    // antes do fetch e só gravava o INSERT depois — duas execuções concorrentes do cron
    // passavam ambas pelo SELECT e disparavam o mesmo step em duplicidade. Índice único por
    // hora-cheia (date_trunc) permite reivindicar a tentativa atomicamente via
    // INSERT...ON CONFLICT DO NOTHING antes de chamar a rota de auto-fix, no mesmo espírito
    // do claim de facebook-comentarios acima. Nuance: cooldown passa a ser por hora-relógio
    // (ex.: 10:58 e 11:01 contam como horas diferentes) em vez de janela deslizante de 60min
    // — suficiente para o objetivo real ("evitar re-disparar o mesmo step em loop").
    await sql`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_agentes_log_autofix_unique
      ON agentes_log (acao, date_trunc('hour', created_at))
      WHERE agente = 'mateus-manchete' AND acao LIKE 'auto_fix_%'
    `;

    // ── ÍNDICES DE PERFORMANCE ──────────────────────────────────────────────
    // FASE 22: sem estes índices, agentes_log/pagamentos/usuarios fazem full
    // table scan a cada webhook/cron — as colunas abaixo são filtradas em
    // praticamente toda rota fiscal-* e no webhook do Mercado Pago.
    await sql`CREATE INDEX IF NOT EXISTS idx_agentes_log_agente_created_at ON agentes_log(agente, created_at)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pagamentos_usuario_id ON pagamentos(usuario_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pagamentos_assinatura_id ON pagamentos(assinatura_id)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pagamentos_status ON pagamentos(status)`;
    await sql`CREATE INDEX IF NOT EXISTS idx_usuarios_mp_subscription_id ON usuarios(mp_subscription_id)`;

    // Item 21 (Fase 30): campanha-recuperacao.ts consulta agentes_log filtrando por
    // agente='rebeca-recuperacao' + detalhes->>'usuarioId' + detalhes->>'dia' — sem
    // índice de expressão, cada consulta varria o texto do JSON em toda a tabela.
    await sql`
      CREATE INDEX IF NOT EXISTS idx_agentes_log_rebeca_usuario_dia
      ON agentes_log ((detalhes->>'usuarioId'), (detalhes->>'dia'))
      WHERE agente = 'rebeca-recuperacao' AND status = 'sucesso'
    `;

    // Item 22 (Fase 30): radar-politico.ts conta quantos alertas cada pessoa já gerou
    // hoje com WHERE politico = X AND processado = true — sem índice, full table scan
    // a cada execução do cron (roda a cada 30min).
    await sql`
      CREATE INDEX IF NOT EXISTS idx_radar_politico_politico_created
      ON radar_politico (politico, created_at)
      WHERE processado = true
    `;

    // FASE 23: sem isto, duas requisições concorrentes de criação de assinatura
    // (duplo clique, retry, 2 abas) passam ambas pelo SELECT de status antes de
    // qualquer uma confirmar pagamento no MP, gerando 2 PreApprovals/cobranças
    // distintas para o mesmo usuário — o UNIQUE em mp_subscription_id não pega
    // esse caso porque cada PreApproval tem um id diferente.
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS idx_assinaturas_usuario_ativa ON assinaturas(usuario_id) WHERE status = 'ativa'`;
    await sql`CREATE INDEX IF NOT EXISTS idx_pagamentos_created_at ON pagamentos(created_at)`;

    // FASE 23: coletar-noticias/coletar-noticias-global faziam SELECT (checar duplicata)
    // seguido de INSERT em requisições separadas — 2 execuções concorrentes do cron (ou
    // RSS+YouTube do mesmo ciclo) podiam ambas passar pelo SELECT antes de qualquer uma
    // inserir, duplicando a notícia. Além disso, radar-politico já usa
    // `ON CONFLICT (url) DO NOTHING` ao inserir em noticias, o que sem este índice único
    // gera erro em runtime ("no unique or exclusion constraint matching ON CONFLICT").
    await sql`CREATE UNIQUE INDEX IF NOT EXISTS noticias_url_unique ON noticias(url) WHERE url IS NOT NULL`;

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
    // FASE 24: rota de DDL completo — String(err) podia expor nomes reais de
    // tabelas/colunas/constraints internas. Mesma proteção das outras 7 rotas admin.
    console.error("setup/route.ts error:", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
