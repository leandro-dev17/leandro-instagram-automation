/**
 * AGENTE AUGUSTO ASSINATURAS
 * Webhook do Mercado Pago — processa pagamentos, renovações e cancelamentos.
 * Ativa/desativa acesso ao grupo WhatsApp automaticamente.
 */

import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { MercadoPagoConfig, Payment, PreApproval } from "mercadopago";
import { enviarEmailBoasVindas, enviarEmailCancelamento, enviarEmailInadimplente } from "@/lib/brevo";
import { enviarMensagemPrivada, adicionarMembroGrupo, removerMembroGrupo, buildBoasVindas, getLinkGrupo } from "@/lib/whatsapp";
import { alertarTelegram } from "@/lib/telegram";
import type { Plano } from "@/lib/db";

const client = new MercadoPagoConfig({
  accessToken: process.env.MERCADOPAGO_ACCESS_TOKEN!,
});

// ─── ATIVAR ACESSO ─────────────────────────────────────────────────────────────

async function ativarAcesso(usuarioId: number, plano: Plano, mpSubscriptionId: string, valor: number, ciclo: "mensal" | "anual" = "mensal", mpPaymentId?: string, metodo: string = "desconhecido", cupom?: string) {
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
      return;
    }
    throw err;
  }

  // Busca dados do usuário
  const rows = await sql`SELECT nome, email, telefone FROM usuarios WHERE id = ${usuarioId} LIMIT 1`;
  if (rows.length === 0) return;
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
}

// ─── RENOVAR ACESSO ────────────────────────────────────────────────────────────

async function renovarAcesso(mpSubscriptionId: string, mpPaymentId: string, valor: number) {
  // FASE 21: mesmo motivo do ativarAcesso — as 3 escritas viram um único lote atômico.
  // O INSERT em pagamentos usa SELECT...FROM assinaturas (em vez de VALUES com id da
  // query anterior) para que, se a assinatura não existir, ele simplesmente não insira
  // nenhuma linha (0 rows do SELECT), preservando o comportamento condicional original
  // sem depender do resultado de uma query anterior dentro do mesmo lote.
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

// ─── DESATIVAR ACESSO ──────────────────────────────────────────────────────────

async function desativarAcesso(mpSubscriptionId: string, motivo: "cancelado" | "inadimplente") {
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
    // FASE 24: mesmo bug que a FASE 17 já tinha corrigido em moderacao-grupo — o
    // retorno de removerMembroGrupo era ignorado e o banco marcava 'removido'
    // mesmo quando a chamada à Evolution API falhava (ex: sessão do WhatsApp
    // desconectada). Resultado real: usuário cancelado continuava no grupo pago
    // vendo conteúdo de graça, e como membros_grupos já constava 'removido', o
    // cron de retry (miguel-moderacao) nunca tentava de novo. Agora só marca
    // 'removido' se a remoção de fato aconteceu; senão deixa 'ativo' para o
    // cron tentar novamente depois.
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

// ─── VALIDAÇÃO HMAC ────────────────────────────────────────────────────────────

async function hmacSha256(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]
  );
  const buf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function validarWebhook(req: NextRequest): Promise<boolean> {
  const secret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
  const xSignature = req.headers.get("x-signature");

  // Sem x-signature: MP ainda não configurou secret → aceitar
  if (!xSignature) {
    console.log("[webhook-mp] Sem x-signature — aceitando sem validação HMAC");
    return true;
  }

  // Com x-signature mas sem secret → não conseguimos validar
  if (!secret) {
    console.error("[webhook-mp] x-signature presente mas MERCADOPAGO_WEBHOOK_SECRET não configurada");
    return false;
  }

  const xRequestId = req.headers.get("x-request-id") || "";
  const ts = xSignature.match(/ts=([^,]+)/)?.[1];
  const v1 = xSignature.match(/v1=([^,]+)/)?.[1];

  if (!ts || !v1) {
    console.error("[webhook-mp] x-signature malformado:", xSignature);
    return false;
  }

  const dataId = new URL(req.url).searchParams.get("data.id") || "";

  // Tenta manifests alternativos (MP varia o formato dependendo da versão)
  const manifests = [
    `id:${dataId};request-id:${xRequestId};ts:${ts};`,   // formato completo
    `id:${dataId};request-id:;ts:${ts};`,                 // sem request-id
    `id:${dataId};ts:${ts};`,                             // minimalista
  ];

  for (const manifest of manifests) {
    const computed = await hmacSha256(secret, manifest);
    if (computed === v1) {
      console.log("[webhook-mp] HMAC válido ✓ manifest:", manifest);
      return true;
    }
  }

  console.error("[webhook-mp] HMAC inválido. v1 esperado:", v1, "| dataId:", dataId, "| ts:", ts, "| x-request-id:", xRequestId);
  return false;
}

// ─── HANDLER PRINCIPAL ─────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.text();
    console.log("[webhook-mp] Recebido — url:", req.url, "| x-signature:", req.headers.get("x-signature")?.substring(0, 40) || "AUSENTE");

    if (!(await validarWebhook(req))) {
      console.error("[webhook-mp] Validação falhou — descartando evento");
      return NextResponse.json({ ok: true }); // 200 para MP não retentar
    }

    const body = JSON.parse(rawBody);
    const tipo = body.type as string;
    const dataId = body.data?.id as string | undefined;
    console.log("[webhook-mp] tipo:", tipo, "| dataId:", dataId);
    if (!dataId) return NextResponse.json({ ok: true });

    // Rate limiting: rejeita o mesmo dataId processado nos últimos 5 minutos
    const jaProcessado = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'augusto-assinaturas'
        AND (detalhes->>'dataId') = ${dataId}
        AND created_at > NOW() - INTERVAL '5 minutes'
      LIMIT 1
    `.catch(() => []);
    if (jaProcessado.length > 0) {
      console.log("[webhook-mp] Duplicata ignorada — dataId:", dataId);
      return NextResponse.json({ ok: true, motivo: "duplicata ignorada" });
    }

    if (tipo === "subscription_preapproval") {
      const preApprovalClient = new PreApproval(client);
      const pa = await preApprovalClient.get({ id: dataId });
      console.log("[webhook-mp] preapproval status:", pa.status, "| external_reference:", pa.external_reference);

      if (pa.status === "authorized") {
        // external_reference: "usuarioId|plano|ciclo" ou "usuarioId|plano|ciclo|CUPOM"
        const partes = (pa.external_reference || "").split("|");
        const usuarioId = parseInt(partes[0]);
        const plano = (partes[1] || "vip") as Plano;
        const ciclo = (partes[2] || "mensal") as "mensal" | "anual";
        const cupom = partes[3] || undefined;
        const valor = (pa.auto_recurring as { transaction_amount?: number })?.transaction_amount ?? 0;
        console.log("[webhook-mp] Ativando acesso — usuarioId:", usuarioId, "| plano:", plano, "| ciclo:", ciclo, "| valor:", valor, "| cupom:", cupom || "(nenhum)");

        if (usuarioId && !isNaN(usuarioId) && ["vip","elite"].includes(plano)) {
          if (!valor || isNaN(valor) || valor <= 0) {
            console.error("[webhook-mp] valor inválido — acesso NÃO ativado. usuarioId:", usuarioId, "| valor:", valor);
            await alertarTelegram("🔴", "Webhook MP — valor inválido, acesso NÃO ativado", `usuarioId: ${usuarioId} | plano: ${plano} | valor recebido: ${valor} | dataId: ${dataId}`);
          } else {
            await ativarAcesso(usuarioId, plano, dataId, valor, ciclo, undefined, "desconhecido", cupom);
            console.log("[webhook-mp] ativarAcesso concluído para usuarioId:", usuarioId);
          }
        } else {
          console.error("[webhook-mp] Dados inválidos — usuarioId:", usuarioId, "| plano:", plano);
        }
      } else if (["cancelled"].includes(pa.status || "")) {
        await desativarAcesso(dataId, "cancelado");
      } else if (["paused"].includes(pa.status || "")) {
        await desativarAcesso(dataId, "inadimplente");
      }

    } else if (tipo === "subscription_authorized_payment") {
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });
      const preapprovalId = (payment as unknown as Record<string, unknown>).preapproval_id as string | undefined;

      if (payment.status === "approved" && preapprovalId) {
        const valor = payment.transaction_amount;
        if (!valor || isNaN(valor) || valor <= 0) {
          console.error("[webhook-mp] valor inválido na renovação — NÃO registrado. preapprovalId:", preapprovalId, "| valor:", valor);
          await alertarTelegram("🔴", "Webhook MP — valor inválido na renovação", `preapprovalId: ${preapprovalId} | valor recebido: ${valor} | dataId: ${dataId}`);
        } else {
          await renovarAcesso(preapprovalId, String(dataId), valor);
        }
      } else if (["rejected", "cancelled"].includes(payment.status || "") && preapprovalId) {
        await desativarAcesso(preapprovalId, "inadimplente");
      }

    } else if (tipo === "payment") {
      // Pagamento via Checkout Pro (Preference) ou PIX avulso
      const paymentClient = new Payment(client);
      const payment = await paymentClient.get({ id: dataId });

      if (payment.status === "approved") {
        const meta = payment.metadata as { usuario_id?: number; plano?: string; ciclo?: string } | undefined;

        // Tenta metadata primeiro; fallback para external_reference ("usuarioId|plano|ciclo")
        let usuarioId: number | undefined = meta?.usuario_id ? Number(meta.usuario_id) : undefined;
        let plano = (meta?.plano || "") as Plano;
        let ciclo: "mensal" | "anual" = meta?.ciclo === "anual" ? "anual" : "mensal";

        if (!usuarioId && payment.external_reference) {
          const partes = (payment.external_reference as string).split("|");
          usuarioId = parseInt(partes[0]);
          plano = (partes[1] || "") as Plano;
          ciclo = partes[2] === "anual" ? "anual" : "mensal";
        }

        if (usuarioId && !isNaN(usuarioId) && ["vip", "elite"].includes(plano)) {
          const valor = payment.transaction_amount;
          if (!valor || isNaN(valor) || valor <= 0) {
            console.error("[webhook-mp] valor inválido — acesso NÃO ativado. usuarioId:", usuarioId, "| valor:", valor);
            await alertarTelegram("🔴", "Webhook MP — valor inválido, acesso NÃO ativado", `usuarioId: ${usuarioId} | plano: ${plano} | valor recebido: ${valor} | dataId: ${dataId}`);
          } else {
            await ativarAcesso(usuarioId, plano, String(dataId), valor, ciclo, String(dataId), payment.payment_type_id || "desconhecido");
          }
        } else {
          // FASE 23: pagamento aprovado no MP mas sem usuarioId/plano válido (metadata e
          // external_reference ausentes/corrompidos) — antes isso era descartado em silêncio,
          // sem log nem alerta, e o cliente pagava sem nunca ter o acesso ativado.
          console.error("[webhook-mp] payment aprovado mas dados inválidos — acesso NÃO ativado. usuarioId:", usuarioId, "| plano:", plano, "| dataId:", dataId);
          await alertarTelegram("🔴", "Webhook MP — payment aprovado com dados inválidos, acesso NÃO ativado", `usuarioId: ${usuarioId} | plano: ${plano || "(vazio)"} | dataId: ${dataId}\nVerifique manualmente — cliente pode ter pago sem receber acesso.`);
        }
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("webhook/mercadopago error:", err);
    await alertarTelegram("🔴", "Falha no webhook do Mercado Pago", String(err)).catch(() => {});
    return NextResponse.json({ ok: true }); // sempre 200 para MP
  }
}
