import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE || "vovo-teresinha";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";

async function enviarBoasVindas(numero: string, nome: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY) return false;
  const mensagem =
    `Olá, ${nome}! 🌿\n\n` +
    `Aqui é a Vovó Teresinha, muito feliz em te receber! 🤗\n\n` +
    `No app Receitinhas da Vovó Teresinha você encontra receitas saudáveis e deliciosas pra toda a família.\n\n` +
    `🍲 Já explorou o app? Acesse: ${APP_URL}\n\n` +
    `Qualquer dúvida, pode mandar mensagem aqui. A vovó está sempre aqui pra ajudar! 💚`;

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
    // Busca usuários criados nas últimas 24h que ainda não receberam boas-vindas WPP
    const novos = await sql`
      SELECT u.id, u.nome, u.telefone
      FROM usuarios u
      WHERE u.telefone IS NOT NULL
        AND u.telefone != ''
        AND NOT EXISTS (
          SELECT 1 FROM app_configuracoes ac
          WHERE ac.chave = CONCAT('wpp_boas_vindas_', u.id::text)
        )
      LIMIT 10
    `;

    const enviados: string[] = [];

    for (const usuario of novos) {
      const numero = String(usuario.telefone).replace(/\D/g, "");
      if (numero.length < 10) continue;

      const enviado = await enviarBoasVindas(numero, usuario.nome || "querida");
      if (enviado) {
        await sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${`wpp_boas_vindas_${usuario.id}`}, ${new Date().toISOString()})
          ON CONFLICT (chave) DO UPDATE SET valor = ${new Date().toISOString()}
        `;
        enviados.push(String(usuario.id));
      }
    }

    await resolverFalhas("recepcionista-wpp");
    return NextResponse.json({ ok: true, enviados: enviados.length });
  } catch (err) {
    await reportarFalha("recepcionista-wpp", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
