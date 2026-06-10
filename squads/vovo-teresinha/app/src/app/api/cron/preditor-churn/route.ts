import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import { enviarSaudadeVovo } from "@/lib/reengajamento";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Verifica se coluna last_login existe
    const colunasUsuario = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'usuarios' AND column_name = 'last_login'
    `;

    const temLastLogin = colunasUsuario.length > 0;

    // Verifica se coluna data_expiracao existe em assinaturas
    const colunasAssinatura = await sql`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'assinaturas' AND column_name = 'data_expiracao'
    `;

    const temDataExpiracao = colunasAssinatura.length > 0;

    let inativos: { usuario_id: number; motivo: string }[] = [];

    if (temLastLogin) {
      // Usa last_login real
      const rows = await sql`
        SELECT a.usuario_id
        FROM assinaturas a
        JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.status = 'ativo'
          AND u.tipo_usuario IN ('premium', 'aluna_leandro')
          AND u.last_login < NOW() - INTERVAL '14 days'
      `;
      inativos.push(...(rows as { usuario_id: number }[]).map((r) => ({ usuario_id: r.usuario_id, motivo: "sem login há 14 dias" })));
    } else {
      // Proxy: created_at antigo como sinal de inatividade
      const rows = await sql`
        SELECT a.usuario_id
        FROM assinaturas a
        JOIN usuarios u ON u.id = a.usuario_id
        WHERE a.status = 'ativo'
          AND u.tipo_usuario IN ('premium', 'aluna_leandro')
          AND u.id < (SELECT MAX(id) - 20 FROM usuarios)
      `;
      inativos.push(...(rows as { usuario_id: number }[]).map((r) => ({ usuario_id: r.usuario_id, motivo: "conta antiga sem atividade recente (proxy)" })));
    }

    if (temDataExpiracao) {
      // Expirando em menos de 7 dias
      const rows = await sql`
        SELECT usuario_id
        FROM assinaturas
        WHERE status = 'ativo'
          AND data_expiracao < NOW() + INTERVAL '7 days'
          AND data_expiracao > NOW()
      `;
      inativos.push(...(rows as { usuario_id: number }[]).map((r) => ({ usuario_id: r.usuario_id, motivo: "expira em menos de 7 dias" })));
    } else {
      // Proxy: updated_at antigo como sinal de renovação próxima
      const rows = await sql`
        SELECT usuario_id
        FROM assinaturas
        WHERE status = 'ativo'
          AND renovada_em < NOW() - INTERVAL '83 days'
      `;
      inativos.push(...(rows as { usuario_id: number }[]).map((r) => ({ usuario_id: r.usuario_id, motivo: "renovação próxima (proxy updated_at)" })));
    }

    // Deduplica por usuario_id
    const vistos = new Set<number>();
    const unicos = inativos.filter((i) => {
      if (vistos.has(i.usuario_id)) return false;
      vistos.add(i.usuario_id);
      return true;
    });

    const em_risco = unicos.length;

    // Envia mensagem da vovó sentindo saudade para quem está sumido (cooldown evita spam)
    let mensagens_enviadas = 0;
    for (const i of unicos) {
      if (i.motivo === "sem login há 14 dias" || i.motivo.startsWith("conta antiga")) {
        const enviada = await enviarSaudadeVovo(i.usuario_id);
        if (enviada) mensagens_enviadas++;
      }
    }

    // Salva contagem em app_configuracoes
    await sql`
      INSERT INTO app_configuracoes (chave, valor) VALUES ('usuarios_risco_churn', ${String(em_risco)})
      ON CONFLICT (chave) DO UPDATE SET valor = ${String(em_risco)}
    `;

    if (em_risco > 5) {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      await enviarTelegram(
        `⚠️ <b>Preditor de Churn — ${hora}</b>\n\n` +
          `${em_risco} assinantes em risco de cancelamento.\n\n` +
          `<i>Acesse o painel para tomar ação de retenção.</i>`
      );
    }

    const detalhes = {
      tem_last_login: temLastLogin,
      tem_data_expiracao: temDataExpiracao,
      motivos: unicos.reduce((acc: Record<string, number>, i) => {
        acc[i.motivo] = (acc[i.motivo] || 0) + 1;
        return acc;
      }, {}),
    };

    await resolverFalhas("preditor-churn");
    return NextResponse.json({ em_risco, mensagens_enviadas, detalhes });
  } catch (err) {
    await reportarFalha("preditor-churn", String(err));
    return NextResponse.json({ erro: "Falha no preditor de churn", detalhes: String(err) }, { status: 500 });
  }
}
