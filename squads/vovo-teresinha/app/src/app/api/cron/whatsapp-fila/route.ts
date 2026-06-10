import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarViaEvolution, buildMensagem } from "@/lib/whatsapp";

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (auth !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Garante estrutura das tabelas
    await sql`
      CREATE TABLE IF NOT EXISTS whatsapp_fila (
        id SERIAL PRIMARY KEY,
        usuario_id INT,
        tipo TEXT,
        mensagem TEXT,
        agendado_para TIMESTAMPTZ DEFAULT NOW(),
        enviado BOOLEAN DEFAULT false,
        enviado_em TIMESTAMPTZ,
        tentativas INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )
    `;
    await sql`ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS enviado BOOLEAN DEFAULT false`;
    await sql`ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS tentativas INT DEFAULT 0`;
    await sql`ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS enviado_em TIMESTAMPTZ`;
    await sql`ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS agendado_para TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`;
    await sql`ALTER TABLE alunas_leandro ADD COLUMN IF NOT EXISTS sexo TEXT DEFAULT 'F'`;
    await sql`
      CREATE TABLE IF NOT EXISTS alunas_leandro (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        nome TEXT,
        sexo TEXT DEFAULT 'F',
        ativo BOOLEAN DEFAULT true,
        last_access_at TIMESTAMPTZ
      )
    `;

    // Busca mensagens pendentes prontas para envio (máx 3 tentativas)
    const pendentes = await sql`
      SELECT wf.id, wf.tipo, wf.mensagem, wf.tentativas,
             u.nome, u.whatsapp,
             COALESCE(al.sexo, 'F') as sexo
      FROM whatsapp_fila wf
      JOIN usuarios u ON u.id = wf.usuario_id
      LEFT JOIN alunas_leandro al ON al.email = u.email
      WHERE wf.enviado = false
        AND wf.agendado_para <= NOW()
        AND wf.tentativas < 3
        AND u.whatsapp IS NOT NULL
        AND u.aceita_whatsapp = true
      ORDER BY wf.created_at ASC
      LIMIT 50
    `;

    let enviados = 0;
    let falhas = 0;

    for (const msg of pendentes) {
      const extra = msg.mensagem && msg.mensagem !== msg.tipo ? msg.mensagem : undefined;
      const texto = buildMensagem(msg.tipo, msg.nome || "amiga", msg.sexo, extra);
      const ok = await enviarViaEvolution(msg.whatsapp, texto);

      if (ok) {
        await sql`
          UPDATE whatsapp_fila
          SET enviado = true, enviado_em = NOW(), tentativas = tentativas + 1
          WHERE id = ${msg.id}
        `;
        enviados++;
      } else {
        await sql`
          UPDATE whatsapp_fila SET tentativas = tentativas + 1 WHERE id = ${msg.id}
        `;
        falhas++;
      }
    }

    return NextResponse.json({ dados: { processados: pendentes.length, enviados, falhas } });
  } catch (err) {
    console.error("cron/whatsapp-fila error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
