import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE || "vovo-teresinha";
const WPP_GRUPO_ID = process.env.EVOLUTION_GRUPO_ID; // ID do grupo ou lista de transmissão

async function enviarParaGrupo(mensagem: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY || !WPP_GRUPO_ID) return false;
  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({ number: WPP_GRUPO_ID, text: mensagem }),
      signal: AbortSignal.timeout(15000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  if (!EVO_URL || !EVO_KEY || !WPP_GRUPO_ID) {
    return NextResponse.json({ ok: true, msg: "Evolution API ou grupo WPP não configurado — pulando" });
  }

  try {
    // Verifica se já publicou hoje
    const hoje = new Date().toISOString().split("T")[0];
    const [jaPublicou] = await sql`
      SELECT 1 FROM app_configuracoes
      WHERE chave = ${`wpp_publicado_${hoje}`} LIMIT 1
    `;
    if (jaPublicou) {
      return NextResponse.json({ ok: true, msg: "Já publicado hoje" });
    }

    // Busca receita do dia (free rotativa que ainda não foi publicada no WPP)
    const [receita] = await sql`
      SELECT r.id, r.titulo, r.descricao, r.categoria, r.tempo_preparo, r.calorias, r.porcoes
      FROM receitas r
      WHERE r.is_free_rotativa = TRUE
        AND NOT EXISTS (
          SELECT 1 FROM app_configuracoes ac
          WHERE ac.chave = CONCAT('wpp_receita_', r.id::text)
        )
      ORDER BY RANDOM()
      LIMIT 1
    `;

    if (!receita) {
      return NextResponse.json({ ok: true, msg: "Nenhuma receita disponível para publicar" });
    }

    const mensagem =
      `🍽️ *Receita do Dia — da Vovó Teresinha!*\n\n` +
      `*${receita.titulo}*\n` +
      `_${receita.descricao}_\n\n` +
      `📁 Categoria: ${receita.categoria}\n` +
      `⏱️ Tempo: ${receita.tempo_preparo} minutos\n` +
      (receita.calorias ? `🔥 Calorias: ${receita.calorias} kcal\n` : "") +
      `👥 Porções: ${receita.porcoes}\n\n` +
      `Acesse o app para ver o modo de preparo completo! 💚\n` +
      `_Com carinho, Vovó Teresinha_ 🌿`;

    const enviado = await enviarParaGrupo(mensagem);

    if (enviado) {
      await Promise.all([
        sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${`wpp_publicado_${hoje}`}, ${receita.id.toString()})
          ON CONFLICT (chave) DO UPDATE SET valor = ${receita.id.toString()}
        `,
        sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${`wpp_receita_${receita.id}`}, ${hoje})
          ON CONFLICT (chave) DO UPDATE SET valor = ${hoje}
        `,
      ]);
    }

    await resolverFalhas("publicador-wpp");
    return NextResponse.json({ ok: enviado, receita: receita.titulo });
  } catch (err) {
    await reportarFalha("publicador-wpp", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
