import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE || "vovo-teresinha";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";

async function enviarOferta(numero: string, nome: string, diasAtivo: number): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY) return false;
  const mensagem =
    `Oi, ${nome}! Aqui é a Vovó Teresinha. 🌿\n\n` +
    `Você já está há ${diasAtivo} dias conosco e tenho uma surpresa especial pra você!\n\n` +
    `🎁 *Oferta exclusiva:* Conheça o Livro de Receitas por apenas *R$19,90/mês* (7 dias grátis!) e tenha acesso a TODAS as receitas premium da vovó!\n\n` +
    `✅ +500 receitas saudáveis\n` +
    `✅ Planos personalizados\n` +
    `✅ Novidades toda semana\n\n` +
    `Aproveite: ${APP_URL}/assinar\n\n` +
    `_Com carinho, Vovó Teresinha_ 💚`;

  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INSTANCE}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({ number: numero, text: mensagem }),
      signal: AbortSignal.timeout(10000),
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

  if (!EVO_URL || !EVO_KEY) {
    return NextResponse.json({ ok: true, msg: "Evolution API não configurada — pulando" });
  }

  try {
    // Usuários gratuitos ativos há 7+ dias com WhatsApp que ainda não receberam oferta
    const candidatos = await sql`
      SELECT u.id, u.nome, u.whatsapp,
             EXTRACT(DAY FROM NOW() - u.criado_em)::int as dias_ativo
      FROM usuarios u
      WHERE u.tipo_usuario = 'free'
        AND u.whatsapp IS NOT NULL AND u.whatsapp != ''
        AND u.aceita_whatsapp = true
        AND u.criado_em < NOW() - INTERVAL '7 days'
        AND NOT EXISTS (
          SELECT 1 FROM app_configuracoes ac
          WHERE ac.chave = CONCAT('wpp_oferta_', u.id::text)
        )
        AND NOT EXISTS (
          SELECT 1 FROM assinaturas a
          WHERE a.usuario_id = u.id AND a.status = 'ativo'
        )
      ORDER BY u.id ASC
      LIMIT 5
    `;

    const convertidos: string[] = [];

    for (const u of candidatos) {
      const numero = String(u.whatsapp).replace(/\D/g, "");
      if (numero.length < 10) continue;

      const enviado = await enviarOferta(numero, u.nome || "querida", u.dias_ativo);
      if (enviado) {
        await sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${`wpp_oferta_${u.id}`}, ${new Date().toISOString()})
          ON CONFLICT (chave) DO UPDATE SET valor = ${new Date().toISOString()}
        `;
        convertidos.push(String(u.id));
      }
    }

    await resolverFalhas("conversor-wpp");
    return NextResponse.json({ ok: true, ofertas_enviadas: convertidos.length });
  } catch (err) {
    await reportarFalha("conversor-wpp", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
