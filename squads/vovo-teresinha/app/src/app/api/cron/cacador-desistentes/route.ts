import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Busca cancelados/pausados nos últimos 30 dias
    const cancelados = await sql`
      SELECT a.usuario_id, u.email, u.nome
      FROM assinaturas a
      JOIN usuarios u ON u.id = a.usuario_id
      WHERE a.status IN ('cancelado', 'paused')
        AND a.renovada_em > NOW() - INTERVAL '30 days'
    ` as { usuario_id: number; email: string; nome: string }[];

    const total_cancelados = cancelados.length;
    const emails: string[] = [];
    let novos_para_contatar = 0;

    for (const user of cancelados) {
      if (novos_para_contatar >= 10) break;

      const chave = `desistente_contatado_${user.usuario_id}`;
      const jaContatado = await sql`
        SELECT id FROM app_configuracoes WHERE chave = ${chave}
      `;

      if (jaContatado.length === 0) {
        await sql`
          INSERT INTO app_configuracoes (chave, valor) VALUES (${chave}, ${new Date().toISOString()})
          ON CONFLICT (chave) DO NOTHING
        `;
        emails.push(user.email);
        novos_para_contatar++;
      }
    }

    if (novos_para_contatar > 0) {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      await enviarTelegram(
        `🎯 <b>Caçador de Desistentes — ${hora}</b>\n\n` +
          `Total cancelados/pausados (30 dias): ${total_cancelados}\n` +
          `Novos para contatar: ${novos_para_contatar}\n\n` +
          `<b>Emails para campanha de reativação:</b>\n` +
          emails.join("\n") +
          `\n\n<i>Envie campanha de reativação para estes contatos.</i>`
      );
    }

    await resolverFalhas("cacador-desistentes");
    return NextResponse.json({ total_cancelados, novos_para_contatar, emails });
  } catch (err) {
    await reportarFalha("cacador-desistentes", String(err));
    return NextResponse.json({ erro: "Falha no caçador de desistentes", detalhes: String(err) }, { status: 500 });
  }
}
