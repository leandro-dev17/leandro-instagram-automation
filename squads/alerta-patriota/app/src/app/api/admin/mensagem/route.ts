import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import type { Plano } from "@/lib/db";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || "alertapatriota";

const GROUP_IDS: Record<string, string> = {
  vip:   process.env.WPP_GROUP_VIP   || "",
  elite: process.env.WPP_GROUP_ELITE || "",
};

export async function POST(req: NextRequest) {
  try {
    await requireAdmin();
    const { grupo, mensagem, tipo = "admin_manual" } = await req.json();

    if (!mensagem?.trim()) return NextResponse.json({ erro: "Mensagem vazia" }, { status: 400 });

    const groupJid = GROUP_IDS[grupo as Plano];
    if (!groupJid) return NextResponse.json({ erro: "Grupo inválido" }, { status: 400 });

    if (!EVO_URL || !EVO_KEY) return NextResponse.json({ erro: "Evolution API não configurada" }, { status: 500 });

    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({ number: groupJid, text: mensagem }),
    });

    if (!res.ok) return NextResponse.json({ erro: "Falha ao enviar mensagem" }, { status: 500 });

    // Registra o grupo para salvar o post
    const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${grupo} LIMIT 1`;
    if (grupoRows.length > 0) {
      await sql`
        INSERT INTO posts_whatsapp (grupo_id, conteudo, tipo, status)
        VALUES (${grupoRows[0].id}, ${mensagem}, ${tipo}, 'enviado')
      `;
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('admin-manual', 'enviar_mensagem', 'sucesso', ${JSON.stringify({ grupo, chars: mensagem.length })})`;

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
