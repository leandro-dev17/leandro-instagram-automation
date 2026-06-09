import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession } from "@/lib/auth";

export async function GET() {
  try {
    const session = await getSession();
    if (!session || session.tipo_usuario !== "admin") {
      return NextResponse.json({ erro: "Não autorizado" }, { status: 403 });
    }

    // Tenta whatsapp_queue (nova tabela), fallback para whatsapp_fila (tabela original)
    const rows = await sql`
      SELECT id, telefone, mensagem, status, tentativas, created_at, enviado_em
      FROM whatsapp_queue
      ORDER BY created_at DESC
      LIMIT 100
    `.catch(() => sql`
      SELECT wf.id,
             COALESCE(u.whatsapp, '') as telefone,
             wf.mensagem,
             CASE WHEN wf.enviado THEN 'enviado' ELSE 'pendente' END as status,
             0 as tentativas,
             wf.created_at,
             NULL as enviado_em
      FROM whatsapp_fila wf
      LEFT JOIN usuarios u ON u.id = wf.usuario_id
      ORDER BY wf.created_at DESC
      LIMIT 100
    `);

    return NextResponse.json({ dados: rows });
  } catch (err) {
    console.error("admin/whatsapp/fila error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
