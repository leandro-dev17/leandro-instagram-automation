import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import { enfileirarMensagem } from "@/lib/whatsapp";

// Toda sexta-feira, convida usuários a voltarem ao app sugerindo
// uma receita para o jantar e para se programar pro fim de semana.

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const hoje = new Date();
    if (hoje.getDay() !== 5) {
      await resolverFalhas("convite-fim-de-semana");
      return NextResponse.json({ ok: true, msg: "Hoje não é sexta-feira" });
    }

    const semanaAtual = `${hoje.getFullYear()}-W${String(
      Math.ceil((hoje.getTime() - new Date(hoje.getFullYear(), 0, 1).getTime()) / 604800000)
    ).padStart(2, "0")}`;

    // Sugestão de receita para o jantar (fallback: qualquer receita recente)
    const sugestoes = await sql`
      SELECT titulo FROM receitas WHERE refeicao = 'jantar'
      ORDER BY RANDOM() LIMIT 1
    ` as { titulo: string }[];

    const receita = sugestoes[0] ?? (
      (await sql`SELECT titulo FROM receitas ORDER BY created_at DESC LIMIT 1` as { titulo: string }[])[0]
    );

    const usuarios = await sql`
      SELECT id FROM usuarios
      WHERE whatsapp IS NOT NULL AND aceita_whatsapp = true AND tipo_usuario != 'admin'
    ` as { id: number }[];

    let convidados = 0;
    for (const u of usuarios) {
      const chave = `convite_fds_${u.id}_${semanaAtual}`;
      const existente = await sql`SELECT chave FROM app_configuracoes WHERE chave = ${chave}`;
      if (existente.length > 0) continue;

      await sql`
        INSERT INTO app_configuracoes (chave, valor) VALUES (${chave}, ${new Date().toISOString()})
        ON CONFLICT (chave) DO NOTHING
      `;
      await enfileirarMensagem(u.id, "convite_fim_de_semana", receita?.titulo);
      convidados++;
    }

    await enviarTelegram(
      `🌸 <b>Convite de Fim de Semana — Vovó</b>\n\n` +
        `Receita sugerida: ${receita?.titulo ?? "(nenhuma encontrada)"}\n` +
        `Usuárias convidadas: ${convidados}`
    );

    await resolverFalhas("convite-fim-de-semana");
    return NextResponse.json({ ok: true, receita: receita?.titulo ?? null, convidados });
  } catch (err) {
    await reportarFalha("convite-fim-de-semana", String(err));
    return NextResponse.json({ erro: "Falha no convite de fim de semana", detalhes: String(err) }, { status: 500 });
  }
}
