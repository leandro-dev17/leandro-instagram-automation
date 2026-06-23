import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { removerMembroGrupo } from "@/lib/whatsapp";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import type { Plano } from "@/lib/db";

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN! });

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    await requireAdmin();
    const usuario = await sql`
      SELECT id, nome, email, telefone, plano, status, tipo_usuario, mp_subscription_id, mp_customer_id,
             trial_inicio, trial_fim, assinatura_inicio, assinatura_fim, created_at, updated_at
      FROM usuarios WHERE id = ${params.id} LIMIT 1
    `;
    const pagamentos = await sql`SELECT * FROM pagamentos WHERE usuario_id = ${params.id} ORDER BY created_at DESC LIMIT 20`;
    const logs = await sql`SELECT * FROM agentes_log WHERE detalhes->>'usuarioId' = ${params.id} ORDER BY created_at DESC LIMIT 20`;
    return NextResponse.json({ usuario: usuario[0], pagamentos, logs });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();
    const { acao, plano, motivo } = await req.json();
    const id = parseInt(params.id);

    if (acao === "mudar_plano" && plano) {
      await sql`UPDATE usuarios SET plano = ${plano}, updated_at = NOW() WHERE id = ${id}`;
    } else if (acao === "cancelar") {
      const u = await sql`SELECT telefone, plano, mp_subscription_id FROM usuarios WHERE id = ${id} LIMIT 1`;

      // Cancela de fato a cobrança recorrente no Mercado Pago antes de marcar como cancelado
      // localmente — sem isso o cliente perde o acesso mas continua sendo cobrado.
      if (u[0]?.mp_subscription_id) {
        try {
          await new PreApproval(mpClient).update({ id: u[0].mp_subscription_id, body: { status: "cancelled" } });
        } catch (e) {
          return NextResponse.json({ erro: `Falha ao cancelar assinatura no Mercado Pago — nada foi alterado: ${String(e)}` }, { status: 502 });
        }
      }

      if (u[0]?.telefone && u[0]?.plano) await removerMembroGrupo(u[0].telefone, u[0].plano as Plano);
      await sql`UPDATE usuarios SET status = 'cancelado', updated_at = NOW() WHERE id = ${id}`;
      await sql`UPDATE assinaturas SET status = 'cancelada' WHERE usuario_id = ${id} AND status = 'ativa'`;
    } else if (acao === "reativar") {
      await sql`UPDATE usuarios SET status = 'ativo', updated_at = NOW() WHERE id = ${id}`;
    } else if (acao === "mudar_tipo") {
      if (motivo !== "admin" && motivo !== "cliente") {
        return NextResponse.json({ erro: "tipo_usuario inválido — use 'admin' ou 'cliente'" }, { status: 400 });
      }
      await sql`UPDATE usuarios SET tipo_usuario = ${motivo}, updated_at = NOW() WHERE id = ${id}`;
    } else if (acao === "excluir_dados") {
      // LGPD — direito ao esquecimento. Não pode ser um DELETE FROM usuarios: a FK
      // usuarios(id) ON DELETE CASCADE em assinaturas/pagamentos apagaria o histórico
      // financeiro que precisa ser retido por obrigação fiscal/contábil. Em vez disso,
      // anonimiza os dados pessoais e mantém o registro (e os vínculos financeiros) intacto.
      const u = await sql`SELECT email, telefone, plano, mp_subscription_id, status FROM usuarios WHERE id = ${id} LIMIT 1`;
      if (!u.length) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

      if (u[0].mp_subscription_id && u[0].status === "ativo") {
        try {
          await new PreApproval(mpClient).update({ id: u[0].mp_subscription_id, body: { status: "cancelled" } });
        } catch (e) {
          return NextResponse.json({ erro: `Falha ao cancelar assinatura no Mercado Pago — exclusão abortada: ${String(e)}` }, { status: 502 });
        }
      }
      if (u[0]?.telefone && u[0]?.plano) await removerMembroGrupo(u[0].telefone, u[0].plano as Plano);

      await sql`
        UPDATE usuarios SET
          nome = 'Usuário excluído', email = ${`excluido-${id}@anonimizado.invalid`},
          telefone = NULL, senha_hash = ${`excluido-${id}`}, status = 'excluido', updated_at = NOW()
        WHERE id = ${id}
      `;
      await sql`UPDATE assinaturas SET status = 'cancelada' WHERE usuario_id = ${id} AND status = 'ativa'`;
      // Apaga também o registro de captura de lead vinculado ao e-mail original (fora de usuarios)
      if (u[0].email) await sql`DELETE FROM leads WHERE email = ${u[0].email}`.catch(() => {});
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('admin-manual', ${acao}, 'sucesso', ${JSON.stringify({ usuarioId: id, plano, motivo, adminId: admin.id, adminEmail: admin.email })})`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
