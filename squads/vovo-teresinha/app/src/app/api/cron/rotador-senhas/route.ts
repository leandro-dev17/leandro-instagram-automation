import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";

// Limpeza mensal de segurança: remove push subscriptions expiradas (>90 dias)
// e identifica usuários inativos há mais de 180 dias para análise de retenção.
// Tokens JWT expiram automaticamente — não há tokens no banco para rotacionar.
export async function GET(req: NextRequest) {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Garante coluna created_at na tabela (pode não existir em instâncias antigas)
    await sql`ALTER TABLE push_subscriptions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;

    // Remove push subscriptions com mais de 90 dias (usuário provavelmente inativo)
    const pushRemovidas = await sql`
      DELETE FROM push_subscriptions
      WHERE created_at < NOW() - INTERVAL '90 days'
      RETURNING id
    `;

    // Identifica usuários free sem atividade há mais de 180 dias e sem assinatura
    const inativos = await sql`
      SELECT u.id, u.email FROM usuarios u
      LEFT JOIN assinaturas a ON a.usuario_id = u.id AND a.status = 'ativo'
      WHERE u.tipo_usuario = 'free'
        AND u.id < (SELECT MAX(id) - 100 FROM usuarios)
        AND u.trial_fim < NOW() - INTERVAL '180 days'
        AND a.id IS NULL
      LIMIT 100
    `;

    const data = new Date().toLocaleDateString("pt-BR");
    const msg =
      `🔑 <b>Limpeza Mensal de Segurança</b>\n` +
      `📅 ${data}\n\n` +
      `🗑️ Push subscriptions expiradas removidas: ${pushRemovidas.length}\n` +
      `👤 Usuários inativos identificados (> 180 dias): ${inativos.length}\n\n` +
      `ℹ️ Tokens JWT expiram automaticamente em 30 dias.\n` +
      `✅ Limpeza concluída sem interrupção de sessões ativas.\n\n` +
      `<i>Próxima execução: 1º do próximo mês</i>`;

    await enviarTelegram(msg);

    return NextResponse.json({
      ok: true,
      push_removidas: pushRemovidas.length,
      inativos_identificados: inativos.length,
    });
  } catch (err) {
    console.error("rotador-senhas error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
