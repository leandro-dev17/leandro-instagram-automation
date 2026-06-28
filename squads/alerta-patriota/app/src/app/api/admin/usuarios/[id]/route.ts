import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { requireAdmin } from "@/lib/auth";
import { removerMembroGrupo, adicionarMembroGrupo, enviarMensagemPrivada } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import { MercadoPagoConfig, PreApproval } from "mercadopago";
import type { Plano } from "@/lib/db";

const mpClient = new MercadoPagoConfig({ accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN! });
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

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
    // FASE 23: String(err) bruto pode incluir mensagem de erro do driver Postgres
    // (nomes de coluna/tabela, fragmento da query) — não deve ir para a resposta HTTP.
    console.error("admin/usuarios/[id] GET error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const admin = await requireAdmin();
    const { acao, plano, motivo } = await req.json();
    const id = parseInt(params.id);

    if (acao === "mudar_plano" && plano) {
      // FASE 24: mesma validação aplicada em admin/usuarios/route.ts — ver comentário lá.
      if (!["vip", "elite"].includes(plano)) {
        return NextResponse.json({ erro: "Plano inválido — use 'vip' ou 'elite'" }, { status: 400 });
      }
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

      // FASE 24: mesmo padrão já aplicado ao webhook do Mercado Pago — sem checar o
      // grupo na tabela membros_grupos, membros_ativos nunca era decrementado e o
      // status do membro ficava 'ativo' para sempre, mesmo após a remoção real do
      // WhatsApp ter funcionado.
      if (u[0]?.telefone && u[0]?.plano) {
        const removido = await removerMembroGrupo(u[0].telefone, u[0].plano as Plano);
        const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${u[0].plano} LIMIT 1`;
        if (removido && grupoRows.length > 0) {
          await sql`
            UPDATE membros_grupos SET status = 'removido', data_saida = NOW()
            WHERE usuario_id = ${id} AND grupo_id = ${grupoRows[0].id}
          `;
          await sql`UPDATE grupos_whatsapp SET membros_ativos = GREATEST(0, membros_ativos - 1) WHERE id = ${grupoRows[0].id}`;
        } else if (!removido) {
          await sql`
            INSERT INTO agentes_log (agente, acao, status, detalhes)
            VALUES ('admin-manual', 'remover_grupo', 'erro',
              ${JSON.stringify({ usuarioId: id, plano: u[0].plano, motivo: "Evolution API recusou a remoção" })})
          `;
        }
      }
      await sql`UPDATE usuarios SET status = 'cancelado', updated_at = NOW() WHERE id = ${id}`;
      await sql`UPDATE assinaturas SET status = 'cancelada' WHERE usuario_id = ${id} AND status = 'ativa'`;
    } else if (acao === "reativar") {
      const u = await sql`SELECT telefone, plano FROM usuarios WHERE id = ${id} LIMIT 1`;
      if (!u.length) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

      await sql`UPDATE usuarios SET status = 'ativo', updated_at = NOW() WHERE id = ${id}`;

      // FASE 30: "Reativar" só trocava o status no banco — não readicionava ao grupo
      // WhatsApp (de onde o usuário tinha sido removido por cancelar/moderacao-grupo) nem
      // recriava cobrança no Mercado Pago. Cliente "reativado" ficava sem receber o produto.
      if (u[0].telefone && u[0].plano) {
        const addOk = await adicionarMembroGrupo(u[0].telefone, u[0].plano as Plano);
        if (addOk) {
          const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${u[0].plano} LIMIT 1`;
          if (grupoRows.length > 0) {
            await sql`
              INSERT INTO membros_grupos (usuario_id, grupo_id, status)
              VALUES (${id}, ${grupoRows[0].id}, 'ativo')
              ON CONFLICT (usuario_id, grupo_id) DO UPDATE SET status = 'ativo', data_saida = NULL
            `;
            await sql`UPDATE grupos_whatsapp SET membros_ativos = membros_ativos + 1 WHERE id = ${grupoRows[0].id}`;
          }
        } else {
          await alertarTelegram("🔴", "Reativação manual — falha ao readicionar ao grupo WhatsApp",
            `usuarioId: ${id} | plano: ${u[0].plano}\nAdicionar ao grupo via Evolution API falhou — ação manual necessária.`
          );
        }

        // A cobrança recorrente cancelada no Mercado Pago não pode ser recriada do lado do
        // servidor — exige o cliente reautorizar com os dados do cartão via checkout (a
        // criação de PreApproval real só acontece em assinaturas/criar-direto, fluxo do
        // próprio cliente). Em vez de deixar "reativado" com acesso de graça e sem nenhuma
        // cobrança em andamento, manda o link de assinatura por WhatsApp para ele refazer.
        await enviarMensagemPrivada(
          u[0].telefone,
          `🔔 *Acesso reativado!*\n\nSeu acesso ao Alerta Patriota foi reativado manualmente. Para manter sua assinatura ativa, finalize sua cobrança aqui: ${APP_URL}/assinar?plano=${u[0].plano}`,
          u[0].plano as Plano
        );
      } else if (!u[0].telefone) {
        await alertarTelegram("🔴", "Reativação manual sem telefone cadastrado", `usuarioId: ${id}\nNão foi possível readicionar ao grupo WhatsApp nem enviar o link de cobrança — verifique manualmente.`);
      }
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
      if (u[0]?.telefone && u[0]?.plano) {
        const removido = await removerMembroGrupo(u[0].telefone, u[0].plano as Plano);
        const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${u[0].plano} LIMIT 1`;
        if (removido && grupoRows.length > 0) {
          await sql`
            UPDATE membros_grupos SET status = 'removido', data_saida = NOW()
            WHERE usuario_id = ${id} AND grupo_id = ${grupoRows[0].id}
          `;
          await sql`UPDATE grupos_whatsapp SET membros_ativos = GREATEST(0, membros_ativos - 1) WHERE id = ${grupoRows[0].id}`;
        } else if (!removido) {
          await sql`
            INSERT INTO agentes_log (agente, acao, status, detalhes)
            VALUES ('admin-manual', 'remover_grupo', 'erro',
              ${JSON.stringify({ usuarioId: id, plano: u[0].plano, motivo: "Evolution API recusou a remoção (excluir_dados)" })})
          `;
        }
      }

      // FASE 24: a anonimização cobria só nome/email/telefone/senha_hash — mp_customer_id
      // (identificador vinculável à pessoa no Mercado Pago) e aceite_termos_ip (dado pessoal,
      // LGPD Art. 5º III) ficavam retidos indefinidamente sem justificativa de retenção
      // (diferente de pagamentos/assinaturas, que têm retenção fiscal documentada).
      await sql`
        UPDATE usuarios SET
          nome = 'Usuário excluído', email = ${`excluido-${id}@anonimizado.invalid`},
          telefone = NULL, senha_hash = ${`excluido-${id}`}, status = 'excluido',
          mp_customer_id = NULL, aceite_termos_ip = NULL, updated_at = NOW()
        WHERE id = ${id}
      `;
      await sql`UPDATE assinaturas SET status = 'cancelada' WHERE usuario_id = ${id} AND status = 'ativa'`;
      // Apaga também o registro de captura de lead vinculado ao e-mail original (fora de usuarios)
      if (u[0].email) await sql`DELETE FROM leads WHERE email = ${u[0].email}`.catch(() => {});

      // FASE 30: a anonimização cobria só a tabela `usuarios` — `agentes_log.detalhes`
      // (JSONB de eventos operacionais como boas-vindas no grupo, sequência de e-mail/WhatsApp
      // de não-conversão) guarda nome/e-mail/telefone em texto puro em registros antigos,
      // recuperáveis via admin/logs mesmo após o "esquecimento" (descumprimento Art. 18 LGPD).
      // jsonb_set com create_missing=false só redige a chave quando ela já existe no registro,
      // sem adicionar campos novos a logs que nunca os tinham.
      await sql`
        UPDATE agentes_log
        SET detalhes = jsonb_set(
              jsonb_set(
                jsonb_set(detalhes, '{email}', '"[REDACTED]"', false),
                '{telefone}', '"[REDACTED]"', false
              ),
              '{nome}', '"[REDACTED]"', false
            )
        WHERE detalhes->>'email' = ${u[0].email}
           OR detalhes->>'telefone' = ${u[0].telefone}
           OR detalhes->>'usuarioId' = ${String(id)}
      `.catch(() => {});
    }

    await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('admin-manual', ${acao}, 'sucesso', ${JSON.stringify({ usuarioId: id, plano, motivo, adminId: admin.id, adminEmail: admin.email })})`;
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("admin/usuarios/[id] PATCH error:", err);
    if (String(err).includes("Acesso negado")) return NextResponse.json({ erro: "Acesso negado" }, { status: 403 });
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
