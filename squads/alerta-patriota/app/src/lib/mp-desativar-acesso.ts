/**
 * Extraído de api/webhook/mercadopago/route.ts (FASE 38) para o mesmo motivo da
 * extração de ativarAcesso na FASE 33: testabilidade sem precisar montar um
 * NextRequest real ou um banco de teste.
 */
import { sql } from "@/lib/db";
import { enviarEmailCancelamento, enviarEmailInadimplente } from "@/lib/brevo";
import { removerMembroGrupo } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import type { Plano } from "@/lib/db";

export async function renovarAcesso(mpSubscriptionId: string, mpPaymentId: string, valor: number) {
  // FASE 21: as 3 escritas viram um único lote atômico. O INSERT em pagamentos usa
  // SELECT...FROM assinaturas (em vez de VALUES com id da query anterior) para que,
  // se a assinatura não existir, ele simplesmente não insira nenhuma linha (0 rows
  // do SELECT), preservando o comportamento condicional original sem depender do
  // resultado de uma query anterior dentro do mesmo lote.
  await sql.transaction([
    sql`
      UPDATE assinaturas SET renovada_em = NOW() WHERE mp_subscription_id = ${mpSubscriptionId}
    `,
    sql`
      UPDATE usuarios SET status = 'ativo', updated_at = NOW()
      WHERE mp_subscription_id = ${mpSubscriptionId} AND status = 'inadimplente'
    `,
    // Registra a cobrança recorrente — sem isso, renovações de cartão nunca aparecem no histórico financeiro
    sql`
      INSERT INTO pagamentos (assinatura_id, usuario_id, valor, status, mp_payment_id, metodo)
      SELECT id, usuario_id, ${valor}, 'aprovado', ${mpPaymentId}, 'cartao_recorrente'
      FROM assinaturas WHERE mp_subscription_id = ${mpSubscriptionId}
      ON CONFLICT (mp_payment_id) DO UPDATE SET status = 'aprovado'
    `,
  ]);
}

export async function desativarAcesso(mpSubscriptionId: string, motivo: "cancelado" | "inadimplente") {
  const rows = await sql`
    SELECT u.id, u.nome, u.email, u.telefone, u.plano
    FROM usuarios u
    WHERE u.mp_subscription_id = ${mpSubscriptionId}
    LIMIT 1
  `;
  if (rows.length === 0) return;

  const { id, nome, email, telefone, plano } = rows[0];

  // FASE 21: mesma razão do ativarAcesso/renovarAcesso — as 2 escritas de status
  // (usuarios + assinaturas) em lote atômico via sql.transaction(), evitando estado
  // inconsistente (ex: usuário marcado inadimplente mas assinatura ainda "ativa").
  await sql.transaction([
    sql`UPDATE usuarios SET status = ${motivo}, updated_at = NOW() WHERE id = ${id}`,
    sql`UPDATE assinaturas SET status = ${motivo} WHERE mp_subscription_id = ${mpSubscriptionId}`,
  ]);

  // Remove do grupo WhatsApp
  if (telefone && plano) {
    // FASE 24: o retorno de removerMembroGrupo era ignorado e o banco marcava 'removido'
    // mesmo quando a chamada à Evolution API falhava (ex: sessão do WhatsApp desconectada).
    // Resultado real: usuário cancelado continuava no grupo pago vendo conteúdo de graça.
    // Agora só marca 'removido' se a remoção de fato aconteceu; senão deixa 'ativo' para
    // o cron tentar novamente depois.
    const removido = await removerMembroGrupo(telefone, plano as Plano);
    const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${plano} LIMIT 1`;
    if (removido && grupoRows.length > 0) {
      await sql`
        UPDATE membros_grupos SET status = 'removido', data_saida = NOW()
        WHERE usuario_id = ${id} AND grupo_id = ${grupoRows[0].id}
      `;
      await sql`UPDATE grupos_whatsapp SET membros_ativos = GREATEST(0, membros_ativos - 1) WHERE id = ${grupoRows[0].id}`;
    } else if (!removido) {
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('augusto-assinaturas', 'remover_grupo', 'erro',
          ${JSON.stringify({ usuarioId: id, plano, motivo: "Evolution API recusou a remoção" })})
      `;
    }
  }

  // E-mail
  if (motivo === "cancelado") {
    await enviarEmailCancelamento(email, nome).catch(() => {});
  } else {
    await enviarEmailInadimplente(email, nome).catch(() => {});
  }

  // Notifica General Alves (CEO) no Telegram
  await alertarTelegram(
    motivo === "cancelado" ? "🟡" : "🔴",
    `Acesso ${motivo}`,
    `Usuário: ${nome} (${email})\nPlano: ${plano}\nMotivo: ${motivo}`
  );

  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes)
    VALUES ('augusto-assinaturas', 'desativar_acesso', 'sucesso', ${JSON.stringify({ id, plano, motivo })})
  `;
}
