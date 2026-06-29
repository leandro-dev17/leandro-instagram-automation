import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import type { Plano } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const admin = await requireAdmin();
    const { grupo, mensagem, tipo = "admin_manual" } = await req.json();

    if (!mensagem?.trim()) return NextResponse.json({ erro: "Mensagem vazia" }, { status: 400 });

    if (!["vip", "elite"].includes(grupo)) return NextResponse.json({ erro: "Grupo inválido" }, { status: 400 });

    const enviado = await enviarMensagemGrupo(grupo as Plano, mensagem);
    if (!enviado) return NextResponse.json({ erro: "Falha ao enviar mensagem" }, { status: 500 });

    // Registra o grupo para salvar o post
    const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${grupo} LIMIT 1`;
    if (grupoRows.length > 0) {
      await sql`
        INSERT INTO posts_whatsapp (grupo_id, conteudo, tipo, status)
        VALUES (${grupoRows[0].id}, ${mensagem}, ${tipo}, 'enviado')
      `;
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('admin-manual', 'enviar_mensagem', 'sucesso', ${JSON.stringify({ grupo, chars: mensagem.length, adminId: admin.id, adminEmail: admin.email })})`;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("admin/mensagem error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
