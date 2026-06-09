/**
 * REVISOR ARNALDO ARQUITETO — Revisor de Schema
 * Lê alertas abertos do fiscal-codigo-schema e aplica correções automáticas conhecidas.
 * Sempre escala para gerente-codigo após análise.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

// Correções automáticas conhecidas: "tabela.coluna" → SQL de correção
const AUTOCORRECT: Record<string, string> = {
  "usuarios.trial_inicio":        "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_inicio TIMESTAMPTZ",
  "usuarios.trial_fim":           "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS trial_fim TIMESTAMPTZ",
  "usuarios.criado_em":           "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW()",
  "assinaturas.plano":            "ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS plano VARCHAR(50) DEFAULT 'trimestral'",
  "assinaturas.criado_em":        "ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW()",
  "falhas_agentes.dados":         "ALTER TABLE falhas_agentes ADD COLUMN IF NOT EXISTS dados JSONB DEFAULT '{}'",
  "falhas_agentes.tentativas":    "ALTER TABLE falhas_agentes ADD COLUMN IF NOT EXISTS tentativas INTEGER DEFAULT 1",
  "falhas_agentes.resolvido_em":  "ALTER TABLE falhas_agentes ADD COLUMN IF NOT EXISTS resolvido_em TIMESTAMPTZ",
  "push_subscriptions.ativo":     "ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS ativo BOOLEAN DEFAULT true",
  "push_subscriptions.criado_em": "ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW()",
  "whatsapp_fila.enviado_em":     "ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS enviado_em TIMESTAMPTZ",
  "whatsapp_fila.criado_em":      "ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS criado_em TIMESTAMPTZ DEFAULT NOW()",
  "receitas.foto_url":            "ALTER TABLE receitas ADD COLUMN IF NOT EXISTS foto_url TEXT",
  "receitas.tempo_preparo":       "ALTER TABLE receitas ADD COLUMN IF NOT EXISTS tempo_preparo INTEGER DEFAULT 30",
  "lista_compras.comprado":       "ALTER TABLE lista_compras ADD COLUMN IF NOT EXISTS comprado BOOLEAN DEFAULT false",
  "geladeira_ingredientes.unidade":"ALTER TABLE geladeira_ingredientes ADD COLUMN IF NOT EXISTS unidade VARCHAR(50) DEFAULT 'unidade'",
  "afiliados.codigo":             "ALTER TABLE afiliados ADD COLUMN IF NOT EXISTS codigo VARCHAR(20) UNIQUE",
  "comissoes.status":             "ALTER TABLE comissoes ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'pendente'",
};

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const alertas = await sql`
      SELECT id, erro, dados FROM falhas_agentes
      WHERE agente = 'fiscal-codigo-schema' AND resolvido = false
      ORDER BY criado_em DESC LIMIT 20
    ` as { id: number; erro: string; dados: Record<string, unknown> }[];

    if (alertas.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas de schema pendentes" });
    }

    const corrigidos: string[] = [];
    const naoCorrigidos: string[] = [];

    for (const alerta of alertas) {
      const dados = alerta.dados as { tabela?: string; faltando?: string[] };
      const tabela = dados.tabela as string | undefined;
      const faltando = dados.faltando as string[] | undefined;

      if (tabela && faltando && faltando[0] !== "TABELA_INEXISTENTE") {
        for (const coluna of faltando) {
          const chave = `${tabela}.${coluna}`;
          const fixSQL = AUTOCORRECT[chave];
          if (fixSQL) {
            try {
              await sql.unsafe(fixSQL);
              corrigidos.push(chave);
            } catch (e) {
              naoCorrigidos.push(`${chave}: ${String(e).slice(0, 100)}`);
            }
          } else {
            naoCorrigidos.push(`${chave}: sem autocorrect definido`);
          }
        }
      } else if (dados.tabela && faltando?.[0] === "TABELA_INEXISTENTE") {
        naoCorrigidos.push(`${tabela}: tabela não existe — requer migração manual`);
      }

      // Marca como resolvido (gerente-codigo decidirá se escala para claude-revisor)
      await sql`UPDATE falhas_agentes SET resolvido = true, resolvido_em = NOW() WHERE id = ${alerta.id}`;
    }

    // Sempre escala para gerente-codigo
    fetch(`${APP}/api/cron/gerente-codigo`, {
      method: "POST",
      headers: { Authorization: `Bearer ${CRON}`, "Content-Type": "application/json" },
      body: JSON.stringify({ origem: "revisor-schema", corrigidos, naoCorrigidos }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {});

    await enviarTelegram(
      `🗄️ <b>Revisor Schema — Relatório</b>\n\n` +
      `✅ Auto-corrigidos (${corrigidos.length}):\n${corrigidos.map(c => `  • ${c}`).join("\n") || "  nenhum"}\n\n` +
      (naoCorrigidos.length > 0
        ? `⚠️ Não corrigidos (${naoCorrigidos.length}):\n${naoCorrigidos.map(c => `  • ${c}`).join("\n")}\n\n`
        : "") +
      `📊 Gerente de Código acionado para consolidação.`
    );

    return NextResponse.json({ ok: true, corrigidos, naoCorrigidos });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
