/**
 * FISCAL CÓDIGO — SCHEMA
 * Compara o schema real do banco com o que o código espera.
 * Detecta colunas faltando, tipos errados, tabelas ausentes.
 * Roda a cada 6h. Escala para revisor-schema se encontrar problema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

// Colunas que o código usa — schema esperado
const SCHEMA_ESPERADO: Record<string, string[]> = {
  usuarios: ["id", "nome", "email", "senha_hash", "telefone", "plano", "status", "tipo_usuario",
    "mp_subscription_id", "trial_inicio", "trial_fim", "assinatura_inicio", "updated_at", "created_at"],
  noticias: ["id", "titulo", "fonte", "url", "resumo_braga", "resumo_cavalcanti", "categoria",
    "urgente", "global", "postada_vip", "postada_elite",
    "postada_vip_at", "postada_elite_at", "created_at"],
  assinaturas: ["id", "usuario_id", "plano", "valor", "ciclo", "status", "mp_subscription_id", "renovada_em", "created_at"],
  grupos_whatsapp: ["id", "nome", "plano", "link_convite", "group_id_wa", "max_membros", "membros_ativos", "ativo", "created_at"],
  membros_grupos: ["id", "usuario_id", "grupo_id", "data_entrada", "data_saida", "status"],
  posts_whatsapp: ["id", "grupo_id", "noticia_id", "conteudo", "tipo", "status", "enviado_at"],
  agentes_log: ["id", "agente", "acao", "status", "detalhes", "duracao_ms", "created_at"],
  alertas: ["id", "tipo", "severidade", "mensagem", "resolvido", "resolvido_at", "created_at"],
  whatsapp_fila: ["id", "usuario_id", "tipo", "mensagem", "tentativas", "agendado_para", "processado_em", "created_at"],
};

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const problemas: string[] = [];

  try {
    // Busca schema real do banco
    const colunas = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position
    `;

    // Monta mapa: tabela → set de colunas reais
    const schemaReal: Record<string, Set<string>> = {};
    for (const col of colunas) {
      const t = col.table_name as string;
      const c = col.column_name as string;
      if (!schemaReal[t]) schemaReal[t] = new Set();
      schemaReal[t].add(c);
    }

    // Compara esperado vs real
    for (const [tabela, colsEsperadas] of Object.entries(SCHEMA_ESPERADO)) {
      if (!schemaReal[tabela]) {
        problemas.push(`TABELA FALTANDO: ${tabela}`);
        continue;
      }
      for (const col of colsEsperadas) {
        if (!schemaReal[tabela].has(col)) {
          problemas.push(`COLUNA FALTANDO: ${tabela}.${col}`);
        }
      }
    }

    // Verifica tabelas essenciais existem
    const tabelasEssenciais = Object.keys(SCHEMA_ESPERADO);
    for (const t of tabelasEssenciais) {
      if (!schemaReal[t]) problemas.push(`TABELA AUSENTE: ${t}`);
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('fiscal-codigo-schema', 'verificar_schema',
        ${problemas.length === 0 ? "sucesso" : "erro"},
        ${JSON.stringify({ tabelasVerificadas: tabelasEssenciais.length, problemas })},
        ${Date.now() - inicio})
    `;

    if (problemas.length > 0) {
      await alertarTelegram("🔴", `FISCAL CÓDIGO — SCHEMA DIVERGENTE (${problemas.length} problemas)`,
        problemas.map(p => `• ${p}`).join("\n") + "\n\n⚠️ Escalando para Revisor de Schema..."
      );
      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES ('codigo_schema', 'critico', ${`Schema divergente: ${problemas.join("; ")}`})
      `;
      await fetch(`${APP}/api/cron/revisor-schema`, {
        headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: problemas.length === 0, tabelasVerificadas: tabelasEssenciais.length, problemas });
  } catch (err) {
    await alertarTelegram("🚨", "FISCAL CÓDIGO SCHEMA — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
