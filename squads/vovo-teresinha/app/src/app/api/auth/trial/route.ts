import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { sql } from "@/lib/db";
import { enfileirarMensagem } from "@/lib/whatsapp";

export async function POST() {
  try {
    const session = await getSession();

    if (!session) {
      return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    }

    const rows = await sql`
      SELECT id, tipo_usuario, trial_inicio FROM usuarios WHERE id = ${session.id} LIMIT 1
    `;

    if (rows.length === 0) {
      return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });
    }

    const user = rows[0];

    if (user.trial_inicio) {
      return NextResponse.json({ erro: "Trial já utilizado" }, { status: 400 });
    }

    if (user.tipo_usuario !== "free") {
      return NextResponse.json({ erro: "Apenas usuários free podem ativar o trial" }, { status: 400 });
    }

    const trialInicio = new Date();
    const trialFim = new Date();
    trialFim.setDate(trialFim.getDate() + 7);

    await sql`
      UPDATE usuarios
      SET trial_inicio = ${trialInicio.toISOString()}, trial_fim = ${trialFim.toISOString()}
      WHERE id = ${session.id}
    `;

    enfileirarMensagem(session.id, "boas_vindas_trial").catch(() => {});

    return NextResponse.json({ dados: { trial_fim: trialFim.toISOString() } });
  } catch (err) {
    console.error("trial error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
