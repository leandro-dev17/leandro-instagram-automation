/**
 * Extraído de api/webhook/mercadopago/route.ts (FASE 33) para ser reutilizado
 * também pelo cron reconciliador-pix — sem isso, qualquer correção feita aqui
 * precisaria ser replicada manualmente nos dois lugares e divergiria com o tempo.
 */
import { sql } from "@/lib/db";
import { enviarEmailBoasVindas } from "@/lib/brevo";
import { enviarMensagemPrivada, adicionarMembroGrupo, buildBoasVindas, getLinkGrupo } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import type { Plano } from "@/lib/db";

// Retorna true se o acesso foi de fato ativado, false se a transação foi
// abortada por assinatura duplicada (23505) — usado pelo reconciliador-pix
// (FASE 40) para não reportar sucesso num caso que na verdade exige estorno manual.
export async function ativarAcesso(usuarioId: number, plano: Plano, mpSubscriptionId: string, valor: number, ciclo: "mensal" | "anual" = "mensal", mpPaymentId?: string, metodo: string = "desconhecido", cupom?: string): Promise<boolean> {
  // FASE 21: as 3 escritas abaixo (usuarios/assinaturas/pagamentos) iam cada uma em sua
  // própria requisição HTTP ao Neon — uma falha de rede entre elas podia deixar o cliente
  // "ativo" sem assinatura registrada, ou pagamento sem assinatura associada. O driver
  // @neondatabase/serverless não suporta transação interativa multi-round-trip sobre HTTP,
  // mas suporta `sql.transaction()` com um lote de queries independentes executadas
  // atomicamente no servidor — por isso o id da assinatura é obtido aqui via subquery
  // (mp_subscription_id), não via variável JS do resultado da query anterior.
  const queries = [
    sql`
      UPDATE usuarios
      SET plano = ${plano}, status = 'ativo', mp_subscription_id = ${mpSubscriptionId},
          assinatura_inicio = NOW(), updated_at = NOW()
      WHERE id = ${usuarioId}
    `,
    sql`
      INSERT INTO assinaturas (usuario_id, plano, valor, ciclo, status, mp_subscription_id, cupom)
      VALUES (${usuarioId}, ${plano}, ${valor}, ${ciclo}, 'ativa', ${mpSubscriptionId}, ${cupom || null})
      ON CONFLICT (mp_subscription_id) DO UPDATE SET status = 'ativa', renovada_em = NOW()
      RETURNING id
    `,
  ];

  // Registra o pagamento real (PIX/Checkout Pro já têm um payment id distinto da assinatura;
  // a aprovação inicial de subscription_preapproval ainda não representa uma cobrança concreta).
  if (mpPaymentId) {
    queries.push(sql`
      INSERT INTO pagamentos (assinatura_id, usuario_id, valor, status, mp_payment_id, metodo, cupom)
      SELECT id, ${usuarioId}, ${valor}, 'aprovado', ${mpPaymentId}, ${metodo}, ${cupom || null}
      FROM assinaturas WHERE mp_subscription_id = ${mpSubscriptionId}
      ON CONFLICT (mp_payment_id) DO UPDATE SET status = 'aprovado', assinatura_id = EXCLUDED.assinatura_id, valor = EXCLUDED.valor
    `);
  }

  try {
    await sql.transaction(queries);
  } catch (err: unknown) {
    // FASE 23: idx_assinaturas_usuario_ativa (índice único parcial criado no admin/setup)
    // rejeita esta INSERT com 23505 quando o usuário já tem outra assinatura 'ativa' —
    // isso acontece quando 2 requisições de criação de assinatura (duplo clique, retry,
    // 2 abas) passam pelo SELECT de status antes de qualquer uma confirmar pagamento no MP,
    // gerando 2 PreApprovals/cobranças distintas para o mesmo usuário. A transação inteira
    // (incluindo o UPDATE em usuarios) é revertida, então o usuário não fica em estado
    // inconsistente — mas a 2ª cobrança no MP já aconteceu e precisa de estorno manual.
    const pgErr = err as { code?: string };
    if (pgErr?.code === "23505") {
      await alertarTelegram(
        "🔴",
        "Assinatura duplicada detectada — estorno manual necessário",
        `usuarioId: ${usuarioId} | plano: ${plano} | nova cobrança mp: ${mpSubscriptionId}\nUsuário já tinha assinatura ativa com outro mp_subscription_id. A 2ª cobrança no Mercado Pago foi efetuada mas NÃO foi ativada no sistema — verifique e estorne a cobrança duplicada manualmente.`
      );
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('augusto-assinaturas', 'ativar_acesso', 'duplicado', ${JSON.stringify({ usuarioId, plano, mpSubscriptionId, dataId: mpSubscriptionId })})
      `.catch(() => {});
      return false;
    }
    throw err;
  }

  // Busca dados do usuário
  const rows = await sql`SELECT nome, email, telefone FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
  if (rows.length === 0) return true;
  const { nome, email, telefone } = rows[0];

  // Adiciona ao grupo WhatsApp
  if (telefone) {
    // FASE 23 (LGPD): console.log vai para o sistema de logs da Vercel, retido por mais
    // tempo e acessível a mais gente que os alertas pontuais do Telegram — não deve
    // conter o telefone completo, só os últimos 4 dígitos para correlação/depuração.
    console.log("[ativar-acesso] Adicionando ao grupo WhatsApp — telefone: ***" + telefone.slice(-4), "| plano:", plano);
    const addOk = await adicionarMembroGrupo(telefone, plano);
    console.log("[ativar-acesso] adicionarMembroGrupo resultado:", addOk);

    if (addOk) {
      // Registra membro no grupo — só se a adição de fato funcionou, senão o contador/status
      // ficam mentindo que o cliente está no grupo quando na verdade não está.
      const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${plano} LIMIT 1`;
      if (grupoRows.length > 0) {
        await sql`
          INSERT INTO membros_grupos (usuario_id, grupo_id, status)
          VALUES (${usuarioId}, ${grupoRows[0].id}, 'ativo')
          ON CONFLICT (usuario_id, grupo_id) DO UPDATE SET status = 'ativo', data_saida = NULL
        `;
        await sql`UPDATE grupos_whatsapp SET membros_ativos = membros_ativos + 1 WHERE id = ${grupoRows[0].id}`;
      }

      // Mensagem de boas-vindas privada
      const msgBoasVindas = buildBoasVindas(plano, nome);
      const msgOk = await enviarMensagemPrivada(telefone, msgBoasVindas, plano);
      console.log("[ativar-acesso] enviarMensagemPrivada resultado:", msgOk);
    } else {
      await alertarTelegram("🔴", "Cliente pagou mas não entrou no grupo WhatsApp", `usuarioId: ${usuarioId} | telefone: ${telefone} | plano: ${plano}\nAdicionar ao grupo via Evolution API falhou — ação manual necessária.`);
    }
  } else {
    console.error("[ativar-acesso] Telefone não encontrado para usuarioId:", usuarioId, "— WhatsApp ignorado");
    await alertarTelegram("🔴", "Cliente pagou mas não tem telefone cadastrado", `usuarioId: ${usuarioId} | plano: ${plano}`);
  }

  // E-mail de boas-vindas
  const linkGrupo = getLinkGrupo(plano);
  const emailOk = await enviarEmailBoasVindas(email, nome, plano, linkGrupo).catch((e) => { console.error("[ativar-acesso] erro email:", e); return false; });
  console.log("[ativar-acesso] enviarEmailBoasVindas resultado:", emailOk, "→ usuarioId:", usuarioId);

  // Log
  await sql`
    INSERT INTO agentes_log (agente, acao, status, detalhes)
    VALUES ('augusto-assinaturas', 'ativar_acesso', 'sucesso', ${JSON.stringify({ usuarioId, plano, mpSubscriptionId, dataId: mpSubscriptionId })})
  `;
  return true;
}
