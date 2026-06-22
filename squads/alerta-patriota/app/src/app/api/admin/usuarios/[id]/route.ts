import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { removerMembroGrupo } from "@/lib/whatsapp";
import type { Plano } from "@/lib/db";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const usuario = await sql`SELECT * FROM usuarios WHERE id = ${params.id} LIMIT 1`;
    const pagamentos = await sql`SELECT * FROM pagamentos WHERE usuario_id = ${params.id} ORDER BY created_at DESC LIMIT 20`;
    const logs = await sql`SELECT * FROM agentes_log WHERE detalhes->>'usuarioId' = ${params.id} ORDER BY created_at DESC LIMIT 20`;
    return NextResponse.json({ usuario: usuario[0], pagamentos, logs });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const { acao, plano, motivo } = await req.json();
    const id = parseInt(params.id);

    if (acao === "mudar_plano" && plano) {
      await sql`UPDATE usuarios SET plano = ${plano}, updated_at = NOW() WHERE id = ${id}`;
    } else if (acao === "cancelar") {
      const u = await sql`SELECT telefone, plano FROM usuarios WHERE id = ${id} LIMIT 1`;
      if (u[0]?.telefone && u[0]?.plano) await removerMembroGrupo(u[0].telefone, u[0].plano as Plano);
      await sql`UPDATE usuarios SET status = 'cancelado', updated_at = NOW() WHERE id = ${id}`;
      await sql`UPDATE assinaturas SET status = 'cancelada' WHERE usuario_id = ${id} AND status = 'ativa'`;
    } else if (acao === "reativar") {
      await sql`UPDATE usuarios SET status = 'ativo', updated_at = NOW() WHERE id = ${id}`;
    } else if (acao === "mudar_tipo") {
      await sql`UPDATE usuarios SET tipo_usuario = ${motivo}, updated_at = NOW() WHERE id = ${id}`;
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('admin-manual', ${acao}, 'sucesso', ${JSON.stringify({ usuarioId: id, plano, motivo })})`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
