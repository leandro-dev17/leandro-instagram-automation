/**
 * REVISOR DE SCHEMA (Nível 3)
 * Acionado pelo fiscal-codigo-schema.
 * Tenta corrigir automaticamente colunas faltando via ALTER TABLE.
 * Escala para gerente-codigo com relatório.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

// Correções automáticas conhecidas — colunas que podem ser adicionadas com segurança
const AUTOCORRECT: Record<string, string> = {
  "whatsapp_fila.mensagem": "ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS mensagem TEXT",
  "noticias.global": "ALTER TABLE noticias ADD COLUMN IF NOT EXISTS global BOOLEAN DEFAULT false",
  "noticias.urgente": "ALTER TABLE noticias ADD COLUMN IF NOT EXISTS urgente BOOLEAN DEFAULT false",
  "assinaturas.ciclo": "ALTER TABLE assinaturas ADD COLUMN IF NOT EXISTS ciclo VARCHAR(10) DEFAULT 'mensal'",
  "usuarios.assinatura_inicio": "ALTER TABLE usuarios ADD COLUMN IF NOT EXISTS assinatura_inicio TIMESTAMP",
};

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const correcoes: string[] = [];
  const pendentes: string[] = [];

  try {
    const alertasSchema = await sql`
      SELECT id, mensagem FROM alertas
      WHERE tipo = 'codigo_schema' AND resolvido = false
      AND created_at >= NOW() - INTERVAL '2 hours'
      ORDER BY created_at DESC LIMIT 10
    `;

    if (alertasSchema.length === 0) {
      return NextResponse.json({ ok: true, motivo: "Sem alertas de schema pendentes" });
    }

    // Tenta autocorreção para cada problema identificado
    for (const alerta of alertasSchema) {
      const msg = alerta.mensagem as string;

      for (const [chave, sqlCmd] of Object.entries(AUTOCORRECT)) {
        if (msg.toLowerCase().includes(chave.toLowerCase())) {
          try {
            await sql.unsafe(sqlCmd);
            correcoes.push(`✅ Corrigido automaticamente: ${chave}`);
            await sql`UPDATE alertas SET resolvido = true, resolvido_at = NOW() WHERE id = ${alerta.id}`;
          } catch (e) {
            pendentes.push(`❌ Falhou autocorreção ${chave}: ${String(e).substring(0, 80)}`);
          }
        }
      }
    }

    // Alertas que não puderam ser autocorrigidos
    const semCorrecao = alertasSchema.length - correcoes.length;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('revisor-schema', 'corrigir_schema', ${correcoes.length > 0 ? "sucesso" : "aviso"},
        ${JSON.stringify({ correcoes, pendentes, semCorrecao })},
        ${Date.now() - inicio})
    `;

    const relatorio = [
      correcoes.length > 0 ? `Correções automáticas:\n${correcoes.join("\n")}` : "",
      pendentes.length > 0 ? `Falhas na correção:\n${pendentes.join("\n")}` : "",
      semCorrecao > 0 ? `${semCorrecao} problema(s) precisam de correção manual` : "",
    ].filter(Boolean).join("\n\n");

    await alertarTelegram(
      correcoes.length > 0 ? "🟢" : "🔴",
      `REVISOR SCHEMA — ${correcoes.length} corrigido(s), ${semCorrecao} pendente(s)`,
      relatorio || "Nenhuma ação necessária" + "\n\n⚠️ Escalando para Gerente de Código..."
    );

    if (semCorrecao > 0 || pendentes.length > 0) {
      await fetch(`${APP}/api/cron/gerente-codigo`, {
        headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: true, correcoes, pendentes, semCorrecao });
  } catch (err) {
    await alertarTelegram("🚨", "REVISOR SCHEMA — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
