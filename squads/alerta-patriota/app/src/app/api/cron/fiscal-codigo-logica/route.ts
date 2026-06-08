/**
 * FISCAL CÓDIGO — LÓGICA
 * Verifica se a lógica de negócio está funcionando corretamente:
 * - Pipeline de notícias (coleta → curadoria → resumo → publicação)
 * - Limites diários de cards sendo respeitados
 * - Agentes críticos rodando nos horários esperados
 * - Duplicatas de publicação
 * Roda a cada 6h. Escala para revisor-logica se encontrar problema.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON = process.env.CRON_SECRET || "";

interface Problema { desc: string; severidade: "critico" | "alto" | "medio" }

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const problemas: Problema[] = [];

  try {
    // 1. Pipeline: notícias coletadas nas últimas 12h
    const coletadas = await sql`
      SELECT COUNT(*) as total FROM noticias WHERE created_at >= NOW() - INTERVAL '12 hours'
    `;
    const totalColetadas = Number(coletadas[0].total);
    if (totalColetadas === 0) {
      problemas.push({ desc: "Nenhuma notícia coletada nas últimas 12h — coletor pode estar parado", severidade: "critico" });
    }

    // 2. Pipeline: proporção sem resumo (backlog muito alto = resumidor parado)
    const semResumo = await sql`
      SELECT COUNT(*) as total FROM noticias WHERE resumo_braga IS NULL AND created_at >= NOW() - INTERVAL '12 hours'
    `;
    const propSemResumo = totalColetadas > 0 ? Number(semResumo[0].total) / totalColetadas : 0;
    if (propSemResumo > 0.90 && totalColetadas > 10) {
      problemas.push({ desc: `Resumidor parado? ${Math.round(propSemResumo * 100)}% das notícias sem resumo (${semResumo[0].total}/${totalColetadas})`, severidade: "alto" });
    }

    // 3. Agentes críticos rodaram hoje?
    const hoje = new Date(); hoje.setHours(0, 0, 0, 0);
    const agentesObrigatorios = ["neto-noticias", "curador-carlos", "bernardo-resumidor", "gerador-card"];
    for (const agente of agentesObrigatorios) {
      const rodou = await sql`
        SELECT id FROM agentes_log WHERE agente = ${agente} AND status = 'sucesso'
        AND created_at >= ${hoje.toISOString()} LIMIT 1
      `;
      if (rodou.length === 0) {
        problemas.push({ desc: `Agente ${agente} não rodou hoje`, severidade: "alto" });
      }
    }

    // 4. Limite diário de cards: VIP/Elite não devem exceder 6, Basico/Patriota não devem exceder 3
    const cardsHoje = await sql`
      SELECT g.plano, COUNT(*) as total
      FROM agentes_log al
      JOIN grupos_whatsapp g ON g.plano = 'basico'
      WHERE al.agente = 'gerador-card' AND al.status = 'sucesso'
      AND al.created_at >= ${hoje.toISOString()}
      GROUP BY g.plano
    `;
    for (const row of cardsHoje) {
      const limite = ["vip", "elite"].includes(row.plano) ? 6 : 3;
      if (Number(row.total) > limite) {
        problemas.push({ desc: `Grupo ${row.plano} excedeu limite: ${row.total}/${limite} cards hoje`, severidade: "medio" });
      }
    }

    // 5. Alertas acumulados sem resolução há mais de 2h
    const alertasCriticos = await sql`
      SELECT COUNT(*) as total FROM alertas
      WHERE resolvido = false AND severidade = 'critico'
      AND created_at <= NOW() - INTERVAL '2 hours'
    `;
    if (Number(alertasCriticos[0].total) > 0) {
      problemas.push({ desc: `${alertasCriticos[0].total} alertas críticos sem resolução há +2h`, severidade: "critico" });
    }

    // 6. Verificar se há publicações duplicadas recentes (mesmo grupo, mesmo tipo, <10min de diferença)
    const duplicatas = await sql`
      SELECT COUNT(*) as total FROM posts_whatsapp a
      JOIN posts_whatsapp b ON a.grupo_id = b.grupo_id AND a.tipo = b.tipo AND b.id > a.id
      AND b.enviado_at - a.enviado_at < INTERVAL '10 minutes'
      AND a.enviado_at > NOW() - INTERVAL '6 hours'
    `;
    if (Number(duplicatas[0].total) > 0) {
      problemas.push({ desc: `${duplicatas[0].total} publicações duplicadas detectadas nas últimas 6h`, severidade: "alto" });
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('fiscal-codigo-logica', 'verificar_logica',
        ${problemas.length === 0 ? "sucesso" : problemas.some(p => p.severidade === "critico") ? "erro" : "aviso"},
        ${JSON.stringify({ problemas, totalColetadas })},
        ${Date.now() - inicio})
    `;

    if (problemas.length > 0) {
      const criticos = problemas.filter(p => p.severidade === "critico");
      await alertarTelegram(
        criticos.length > 0 ? "🚨" : "🔴",
        `FISCAL CÓDIGO — PROBLEMAS DE LÓGICA (${problemas.length})`,
        problemas.map(p => `• [${p.severidade.toUpperCase()}] ${p.desc}`).join("\n") + "\n\n⚠️ Escalando para Revisor de Lógica..."
      );
      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES ('codigo_logica', ${criticos.length > 0 ? "critico" : "alto"},
          ${`Problemas de lógica: ${problemas.map(p => p.desc).join("; ")}`})
      `;
      await fetch(`${APP}/api/cron/revisor-logica`, {
        headers: { Authorization: `Bearer ${CRON}` }, signal: AbortSignal.timeout(5000),
      }).catch(() => {});
    }

    return NextResponse.json({ ok: problemas.length === 0, problemas, totalColetadas });
  } catch (err) {
    await alertarTelegram("🚨", "FISCAL CÓDIGO LÓGICA — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
