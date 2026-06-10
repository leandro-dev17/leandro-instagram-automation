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
    // Usuários free cadastrados há mais de 7 dias que nunca assinaram
    const usuarios = await sql`
      SELECT u.id, u.email, u.nome
      FROM usuarios u
      WHERE u.tipo_usuario = 'free'
        AND u.id < (SELECT MAX(id) - 50 FROM usuarios)
        AND NOT EXISTS (
          SELECT 1 FROM assinaturas a WHERE a.usuario_id = u.id
        )
      LIMIT 20
    ` as { id: number; email: string; nome: string }[];

    const identificados = usuarios.length;
    let novos = 0;
    let ja_contatados = 0;

    for (const user of usuarios) {
      const chave = `campanha_recuperacao_${user.id}`;
      const existente = await sql`
        SELECT id FROM app_configuracoes WHERE chave = ${chave}
      `;

      if (existente.length === 0) {
        await sql`
          INSERT INTO app_configuracoes (chave, valor) VALUES (${chave}, ${new Date().toISOString()})
          ON CONFLICT (chave) DO NOTHING
        `;
        novos++;
        await enviarSaudadeVovo(user.id);
      } else {
        ja_contatados++;
      }
    }

    // Registra timestamp da última campanha
    const agora = new Date().toISOString();
    await sql`
      INSERT INTO app_configuracoes (chave, valor) VALUES ('ultima_campanha_recuperacao', ${agora})
      ON CONFLICT (chave) DO UPDATE SET valor = ${agora}
    `;

    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    await enviarTelegram(
      `📧 <b>Campanha de Recuperação — ${hora}</b>\n\n` +
        `Usuários free inativos (>7 dias, sem assinatura): ${identificados}\n` +
        `Novos para contatar: ${novos}\n` +
        `Já contatados anteriormente: ${ja_contatados}\n\n` +
        `<i>Prepare emails de conversão para os ${novos} novos usuários.</i>`
    );

    await resolverFalhas("campanha-recuperacao");
    return NextResponse.json({ identificados, novos, ja_contatados });
  } catch (err) {
    await reportarFalha("campanha-recuperacao", String(err));
    return NextResponse.json({ erro: "Falha na campanha de recuperação", detalhes: String(err) }, { status: 500 });
  }
}
