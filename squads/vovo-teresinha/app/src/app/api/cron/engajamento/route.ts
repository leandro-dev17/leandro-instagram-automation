import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const MENSAGENS: Record<number, string> = {
  1: "Nova semana, novas receitas!",
  3: "Dica de meio de semana",
  5: "Prepare o fim de semana!",
};

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // 0 = domingo, 1 = segunda, ..., 5 = sexta
    const diaSemana = new Date().getDay();
    const mensagem = MENSAGENS[diaSemana] ?? null;

    const [{ total: totalAssinantes }] = await sql`
      SELECT COUNT(*) as total FROM push_subscriptions
    ` as { total: number }[];

    const assinantes = Number(totalAssinantes);

    if (mensagem) {
      const payload = JSON.stringify({ mensagem, dia_semana: diaSemana, assinantes, agendado_em: new Date().toISOString() });

      await sql`
        INSERT INTO app_configuracoes (chave, valor) VALUES ('engajamento_pendente', ${payload})
        ON CONFLICT (chave) DO UPDATE SET valor = ${payload}
      `;

      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      await enviarTelegram(
        `📣 <b>Engajamento Agendado — ${hora}</b>\n\n` +
          `Mensagem: "${mensagem}"\n` +
          `Assinantes com push: ${assinantes}\n\n` +
          `<i>Notificação registrada em engajamento_pendente para envio.</i>`
      );
    }

    await resolverFalhas("engajamento");
    return NextResponse.json({ dia_semana: diaSemana, mensagem, assinantes });
  } catch (err) {
    await reportarFalha("engajamento", String(err));
    return NextResponse.json({ erro: "Falha no engajamento", detalhes: String(err) }, { status: 500 });
  }
}
