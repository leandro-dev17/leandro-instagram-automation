import { NextRequest, NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const VERCEL_TOKEN = process.env.VERCEL_DEPLOY_TOKEN;
const VERCEL_DEPLOY_HOOK = process.env.VERCEL_DEPLOY_HOOK_URL;

// ===== OPERAÇÕES DISPONÍVEIS PARA O CLAUDE =====
// Todas as queries são parametrizadas e pré-aprovadas

async function diagnosticarSistema() {
  const [usuarios] = await sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE tipo_usuario = 'premium') as premium FROM usuarios`;
  const [assinaturas] = await sql`SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status = 'ativo') as ativas FROM assinaturas`;
  const [inconsistentes] = await sql`
    SELECT COUNT(*) as total FROM usuarios u
    WHERE u.tipo_usuario = 'premium'
      AND NOT EXISTS (SELECT 1 FROM assinaturas a WHERE a.usuario_id = u.id AND a.status = 'ativo')
  `;
  const [semPremium] = await sql`
    SELECT COUNT(*) as total FROM assinaturas a
    WHERE a.status = 'ativo'
      AND NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = a.usuario_id AND u.tipo_usuario = 'premium')
  `;
  const [configs] = await sql`SELECT COUNT(*) as total FROM app_configuracoes`;
  return { usuarios, assinaturas, inconsistentes, semPremium, configs };
}

async function corrigirPremiumSemAssinatura() {
  const resultado = await sql`
    UPDATE usuarios SET tipo_usuario = 'free'
    WHERE tipo_usuario = 'premium'
      AND NOT EXISTS (SELECT 1 FROM assinaturas a WHERE a.usuario_id = usuarios.id AND a.status = 'ativo')
    RETURNING id, email
  `;
  return { corrigidos: resultado.length, emails: resultado.map(r => r.email) };
}

async function corrigirAssinaturaSemPremium() {
  const resultado = await sql`
    UPDATE usuarios SET tipo_usuario = 'premium'
    WHERE id IN (
      SELECT usuario_id FROM assinaturas WHERE status = 'ativo'
    ) AND tipo_usuario != 'premium'
    RETURNING id, email
  `;
  return { corrigidos: resultado.length, emails: resultado.map(r => r.email) };
}

async function limparAssinaturasOrfas() {
  const resultado = await sql`
    DELETE FROM assinaturas WHERE NOT EXISTS (SELECT 1 FROM usuarios u WHERE u.id = assinaturas.usuario_id)
    RETURNING id
  `;
  return { removidas: resultado.length };
}

async function limparPushSubscriptionsAntigas() {
  const resultado = await sql`
    DELETE FROM push_subscriptions WHERE created_at < NOW() - INTERVAL '90 days'
    RETURNING id
  `;
  return { removidas: resultado.length };
}

async function verificarFalhasRecentes(agente: string) {
  const rows = await sql`
    SELECT agente, tentativas, erro, criado_em FROM falhas_agentes
    WHERE agente = ${agente} AND criado_em > NOW() - INTERVAL '24 hours'
    ORDER BY criado_em DESC LIMIT 10
  `;
  return rows;
}

async function atualizarConfiguracao(chave: string, valor: string) {
  await sql`
    INSERT INTO app_configuracoes (chave, valor) VALUES (${chave}, ${valor})
    ON CONFLICT (chave) DO UPDATE SET valor = ${valor}
  `;
  return { ok: true, chave, valor };
}

async function triguerarRedeploy(): Promise<{ ok: boolean; metodo: string; msg: string }> {
  // Opção 1: Deploy hook (mais simples)
  if (VERCEL_DEPLOY_HOOK) {
    try {
      const res = await fetch(VERCEL_DEPLOY_HOOK, {
        method: "POST",
        signal: AbortSignal.timeout(15000),
      });
      if (res.ok) return { ok: true, metodo: "deploy-hook", msg: "Redeploy disparado via deploy hook" };
    } catch { /* tenta token */ }
  }

  // Opção 2: API com token — busca último deploy e redeploya
  if (VERCEL_TOKEN) {
    try {
      const listRes = await fetch(
        "https://api.vercel.com/v6/deployments?limit=1&target=production&state=READY",
        { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(10000) }
      );
      if (!listRes.ok) return { ok: false, metodo: "api-token", msg: "Erro ao listar deployments" };
      const data = await listRes.json();
      const deployId = data.deployments?.[0]?.uid;
      if (!deployId) return { ok: false, metodo: "api-token", msg: "Nenhum deployment encontrado" };

      const redeployRes = await fetch("https://api.vercel.com/v13/deployments", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${VERCEL_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ deploymentId: deployId, target: "production" }),
        signal: AbortSignal.timeout(15000),
      });
      const redeployData = await redeployRes.json();
      if (redeployRes.ok) {
        return { ok: true, metodo: "api-token", msg: `Redeploy iniciado: ${redeployData.id || deployId}` };
      }
      return { ok: false, metodo: "api-token", msg: JSON.stringify(redeployData).slice(0, 200) };
    } catch (e) {
      return { ok: false, metodo: "api-token", msg: String(e).slice(0, 200) };
    }
  }

  return { ok: false, metodo: "nenhum", msg: "VERCEL_DEPLOY_HOOK_URL e VERCEL_DEPLOY_TOKEN não configurados" };
}

// ===== ENDPOINT =====

export async function POST(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const { agente, erro, tentativas, dados } = await req.json();

  try {
  const contexto = `
Você é o Agente de Recuperação Autônomo do app "Receitinhas da Vovó Teresinha".

## Situação Crítica
Agente "${agente}" falhou ${tentativas} vezes consecutivas nas últimas 2 horas.
Erro: ${erro}
Dados: ${JSON.stringify(dados ?? {})}

## Sua missão
1. Diagnostique o problema usando as ferramentas disponíveis
2. Aplique as correções disponíveis que forem pertinentes
3. Envie um relatório completo no final

## Ferramentas disponíveis
- diagnosticar_sistema: visão geral do banco (usuários, assinaturas, configs)
- verificar_falhas_recentes: histórico de falhas do agente problemático
- corrigir_premium_sem_assinatura: rebaixa usuários premium sem assinatura ativa para free
- corrigir_assinatura_sem_premium: promove usuários com assinatura ativa para premium
- limpar_assinaturas_orfas: remove assinaturas sem usuário correspondente
- limpar_push_subscriptions_antigas: remove subscriptions push com mais de 90 dias
- atualizar_configuracao: atualiza uma configuração em app_configuracoes
- triggerar_redeploy: dispara redeploy automático no Vercel (use se suspeitar de problema transitório ou cache)
- enviar_relatorio: envia diagnóstico final via Telegram (OBRIGATÓRIO ao final)

Comece com diagnose_sistema e verificar_falhas_recentes, depois decida o que corrigir.
`.trim();

  const tools: Anthropic.Tool[] = [
    {
      name: "diagnosticar_sistema",
      description: "Retorna estatísticas gerais: total de usuários, assinaturas, inconsistências detectadas.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "verificar_falhas_recentes",
      description: "Retorna o histórico de falhas recentes do agente problemático.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "corrigir_premium_sem_assinatura",
      description: "Rebaixa para 'free' usuários marcados como premium que não têm assinatura ativa. Correto quando o pagamento foi cancelado mas o tipo_usuario não foi atualizado.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "corrigir_assinatura_sem_premium",
      description: "Promove para 'premium' usuários com assinatura ativa que ainda estão marcados como 'free'. Correto quando o webhook MP chegou mas o usuário não foi atualizado.",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "limpar_assinaturas_orfas",
      description: "Remove assinaturas sem usuário correspondente (dados órfãos).",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "limpar_push_subscriptions_antigas",
      description: "Remove push subscriptions com mais de 90 dias (cleanup de segurança).",
      input_schema: { type: "object" as const, properties: {}, required: [] },
    },
    {
      name: "atualizar_configuracao",
      description: "Atualiza uma configuração em app_configuracoes (ex: desativar desconto sazonal incorreto).",
      input_schema: {
        type: "object" as const,
        properties: {
          chave: { type: "string", description: "Nome da configuração" },
          valor: { type: "string", description: "Novo valor" },
          motivo: { type: "string", description: "Por que está alterando" },
        },
        required: ["chave", "valor", "motivo"],
      },
    },
    {
      name: "triggerar_redeploy",
      description: "Dispara um redeploy automático da aplicação no Vercel. Use quando suspeitar de bug transitório que pode ter sido causado por cache ou estado corrompido em memória. Tenta via deploy hook primeiro, depois via API com token.",
      input_schema: {
        type: "object" as const,
        properties: {
          motivo: { type: "string", description: "Por que está fazendo redeploy" },
        },
        required: ["motivo"],
      },
    },
    {
      name: "enviar_relatorio",
      description: "OBRIGATÓRIO ao final. Envia o relatório de diagnóstico e ações via Telegram.",
      input_schema: {
        type: "object" as const,
        properties: {
          diagnostico: { type: "string" },
          acoes_tomadas: { type: "string" },
          codigo_sugerido: { type: "string", description: "Se for bug de código, o código corrigido para o Leandro aplicar" },
          arquivo_sugerido: { type: "string", description: "Caminho do arquivo a ser alterado (ex: src/app/api/cron/fiscal-banco/route.ts)" },
          precisa_intervencao_humana: { type: "boolean" },
        },
        required: ["diagnostico", "acoes_tomadas", "precisa_intervencao_humana"],
      },
    },
  ];

  const messages: Anthropic.MessageParam[] = [
    { role: "user", content: contexto },
  ];

  const acoesTomadas: string[] = [];
  let relatorioFinal: Record<string, unknown> | null = null;

  for (let i = 0; i < 12; i++) {
    const response = await client.messages.create({
      model: "claude-opus-4-8",
      max_tokens: 4096,
      tools,
      messages,
    });

    messages.push({ role: "assistant", content: response.content });
    if (response.stop_reason !== "tool_use") break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const block of response.content) {
      if (block.type !== "tool_use") continue;
      let resultado: unknown = "";

      try {
        switch (block.name) {
          case "diagnosticar_sistema":
            resultado = await diagnosticarSistema();
            break;
          case "verificar_falhas_recentes":
            resultado = await verificarFalhasRecentes(agente);
            break;
          case "corrigir_premium_sem_assinatura":
            resultado = await corrigirPremiumSemAssinatura();
            acoesTomadas.push(`Corrigiu premium sem assinatura: ${JSON.stringify(resultado)}`);
            break;
          case "corrigir_assinatura_sem_premium":
            resultado = await corrigirAssinaturaSemPremium();
            acoesTomadas.push(`Promoveu usuários para premium: ${JSON.stringify(resultado)}`);
            break;
          case "limpar_assinaturas_orfas":
            resultado = await limparAssinaturasOrfas();
            acoesTomadas.push(`Limpou assinaturas órfãs: ${JSON.stringify(resultado)}`);
            break;
          case "limpar_push_subscriptions_antigas":
            resultado = await limparPushSubscriptionsAntigas();
            acoesTomadas.push(`Limpou push subscriptions: ${JSON.stringify(resultado)}`);
            break;
          case "atualizar_configuracao": {
            const { chave, valor, motivo } = block.input as { chave: string; valor: string; motivo: string };
            resultado = await atualizarConfiguracao(chave, valor);
            acoesTomadas.push(`Config atualizada: ${chave}=${valor} — ${motivo}`);
            break;
          }
          case "triggerar_redeploy": {
            const { motivo } = block.input as { motivo: string };
            resultado = await triguerarRedeploy();
            const r = resultado as { ok: boolean; msg: string };
            acoesTomadas.push(`Redeploy: ${r.ok ? "✅" : "❌"} ${r.msg} — Motivo: ${motivo}`);
            break;
          }
          case "enviar_relatorio":
            relatorioFinal = block.input as Record<string, unknown>;
            resultado = "Relatório registrado";
            break;
        }
      } catch (err) {
        resultado = `Erro: ${String(err).slice(0, 200)}`;
      }

      toolResults.push({
        type: "tool_result",
        tool_use_id: block.id,
        content: JSON.stringify(resultado),
      });
    }

    messages.push({ role: "user", content: toolResults });
  }

  // Envia relatório via Telegram
  if (relatorioFinal) {
    const r = relatorioFinal;
    const icone = r.precisa_intervencao_humana ? "🚨" : "🤖✅";

    let msg =
      `${icone} <b>Claude Resolver — ${agente}</b>\n\n` +
      `🔍 <b>Diagnóstico:</b>\n${String(r.diagnostico).slice(0, 600)}\n\n` +
      `🔧 <b>Ações tomadas:</b>\n${String(r.acoes_tomadas).slice(0, 400) || "Nenhuma ação automática aplicada"}`;

    if (r.codigo_sugerido && r.arquivo_sugerido) {
      msg +=
        `\n\n📝 <b>Correção de código necessária:</b>\n` +
        `Arquivo: <code>${r.arquivo_sugerido}</code>\n\n` +
        `<pre>${String(r.codigo_sugerido).slice(0, 600)}</pre>`;
    }

    msg += r.precisa_intervencao_humana
      ? `\n\n⚠️ <b>Leandro, sua atenção é necessária.</b>`
      : `\n\n✅ <b>Resolvido automaticamente. Nenhuma ação necessária.</b>`;

    await enviarTelegram(msg);
  } else {
    await enviarTelegram(
      `🤖 <b>Claude Resolver — ${agente}</b>\n` +
      `Diagnose concluída.\nAções: ${acoesTomadas.join("; ") || "nenhuma"}`
    );
  }

  // Marca falhas como resolvidas se houve correção
  if (acoesTomadas.length > 0) {
    await sql`
      UPDATE falhas_agentes SET resolvido = TRUE, resolvido_em = NOW()
      WHERE agente = ${agente} AND resolvido = FALSE
    `;
  }

  return NextResponse.json({ ok: true, acoesTomadas, relatorio: relatorioFinal });
  } catch (err) {
    console.error("claude-resolver crashed", err);
    await enviarTelegram(
      `🚨 <b>Claude Resolver — CRASH</b>\n\nAgente: ${agente}\nErro: ${String(err).slice(0, 500)}`
    ).catch(() => {});
    return NextResponse.json({ erro: "Erro interno no resolver", detalhe: String(err).slice(0, 300) }, { status: 500 });
  }
}
