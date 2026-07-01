/**
 * FISCAL SEBASTIÃO SCHEMA — Fiscal de Schema do Banco
 * Compara schema real das 13 tabelas vs schema esperado.
 * Se detectar coluna faltando → grava em falhas_agentes e aciona revisor-schema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { alertarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

const SCHEMA_ESPERADO: Record<string, string[]> = {
  usuarios: ["id", "email", "nome", "senha_hash", "tipo_usuario", "trial_inicio", "trial_fim", "criado_em"],
  receitas: ["id", "titulo", "descricao", "categoria", "refeicao", "ingredientes", "modo_preparo", "foto_url", "tempo_preparo", "created_at"],
  favoritos: ["id", "usuario_id", "receita_id", "criado_em"],
  assinaturas: ["id", "usuario_id", "plano", "status", "renovada_em", "criado_em"],
  planos_semanais: ["id", "usuario_id", "semana", "slot", "receita_id"],
  lista_compras: ["id", "usuario_id", "item", "checked", "receita_id", "receita_titulo", "created_at"],
  geladeira_ingredientes: ["id", "usuario_id", "ingrediente", "created_at"],
  push_subscriptions: ["id", "usuario_id", "endpoint", "p256dh", "auth", "ativo", "created_at"],
  whatsapp_fila: ["id", "usuario_id", "tipo", "mensagem", "agendado_para", "enviado", "tentativas", "enviado_em", "created_at"],
  falhas_agentes: ["id", "agente", "erro", "dados", "tentativas", "resolvido", "criado_em"],
  app_configuracoes: ["chave", "valor", "updated_at"],
  afiliados: ["id", "usuario_id", "codigo", "status", "criado_em"],
  comissoes: ["id", "afiliado_id", "valor", "status", "criado_em"],
};

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const falhas: string[] = [];
  const relatorio: Record<string, { ok: boolean; colunasFaltando?: string[] }> = {};

  try {
    const colunas = await sql`
      SELECT table_name, column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = ANY(${Object.keys(SCHEMA_ESPERADO)})
      ORDER BY table_name, ordinal_position
    ` as { table_name: string; column_name: string }[];

    const mapa: Record<string, Set<string>> = {};
    for (const { table_name, column_name } of colunas) {
      if (!mapa[table_name]) mapa[table_name] = new Set();
      mapa[table_name].add(column_name);
    }

    for (const [tabela, colunasEsperadas] of Object.entries(SCHEMA_ESPERADO)) {
      const colunasReais = mapa[tabela];

      if (!colunasReais) {
        const msg = `Tabela '${tabela}' não existe no banco`;
        falhas.push(msg);
        relatorio[tabela] = { ok: false, colunasFaltando: ["TABELA_INEXISTENTE"] };
        await reportarFalha("fiscal-codigo-schema", msg, {
          tipo: "codigo_schema",
          severidade: "critico",
          tabela,
          faltando: ["TABELA_INEXISTENTE"],
        });
        continue;
      }

      const faltando = colunasEsperadas.filter(c => !colunasReais.has(c));
      if (faltando.length > 0) {
        const msg = `Tabela '${tabela}' faltam colunas: ${faltando.join(", ")}`;
        falhas.push(msg);
        relatorio[tabela] = { ok: false, colunasFaltando: faltando };
        await reportarFalha("fiscal-codigo-schema", msg, {
          tipo: "codigo_schema",
          severidade: "alto",
          tabela,
          faltando,
        });
      } else {
        relatorio[tabela] = { ok: true };
      }
    }

    if (falhas.length > 0) {
      fetch(`${APP}/api/cron/revisor-schema`, {
        headers: { Authorization: `Bearer ${CRON}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      await alertarTelegram(
        "🗄️",
        "FISCAL SCHEMA — FALHAS DETECTADAS",
        falhas.map(f => `❌ ${f}`).join("\n") + "\n\n🔧 Revisor de schema acionado."
      );
    } else {
      await resolverFalhas("fiscal-codigo-schema");
    }

    return NextResponse.json({ ok: falhas.length === 0, relatorio, falhas });
  } catch (err) {
    await reportarFalha("fiscal-codigo-schema", String(err), {
      tipo: "codigo_schema",
      severidade: "critico",
    });
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
