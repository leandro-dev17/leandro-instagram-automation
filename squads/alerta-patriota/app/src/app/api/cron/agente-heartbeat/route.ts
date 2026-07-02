/**
 * PAULO PING — Dashboard de saúde consolidado às 8h BRT
 * Verifica todos os subsistemas e envia relatório via Telegram.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";

type Semaforo = "🟢" | "🟡" | "🔴";

interface StatusAgente {
  semaforo: Semaforo;
  ultimaExecucao: string | null;
}

function avaliarAgente(rows: { status: string; created_at: string }[]): StatusAgente {
  if (rows.length === 0) return { semaforo: "🔴", ultimaExecucao: null };

  const ultimo = rows[0];
  const diffMs = Date.now() - new Date(ultimo.created_at).getTime();
  const diffH = diffMs / 3_600_000;

  if (ultimo.status === "erro" || diffH > 4) return { semaforo: "🔴", ultimaExecucao: ultimo.created_at };
  if (ultimo.status === "aviso" || diffH > 2) return { semaforo: "🟡", ultimaExecucao: ultimo.created_at };
  return { semaforo: "🟢", ultimaExecucao: ultimo.created_at };
}

function formatarHora(iso: string | null): string {
  if (!iso) return "nunca";
  return new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

// Fase 34 (backlog seg/infra, item 5): se o próprio GitHub Actions parar de disparar este
// cron (já aconteceu antes, Fase 15 — job "Fiscais 24/7" cancelado em produção sem ninguém
// notar), o alerta no Telegram nunca dispara, porque depende deste cron rodar. Um "dead man's
// switch" externo (ex: healthchecks.io) detecta a AUSÊNCIA do ping, não depende deste código
// rodar para avisar. DEADMAN_SWITCH_URL fica vazia até o usuário criar a conta e configurar —
// sem a env var, esta função não faz nada (sem mudança de comportamento até então).
async function avisarDeadManSwitch(): Promise<void> {
  const url = process.env.DEADMAN_SWITCH_URL;
  if (!url) return;
  await fetch(url, { signal: AbortSignal.timeout(5000) }).catch(() => {});
}

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);

  try {
    const jaRodou = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'paulo-ping'
        AND status = 'sucesso'
        AND created_at >= ${hoje.toISOString()}
      LIMIT 1
    `;

    if (jaRodou.length > 0) {
      return NextResponse.json({ ok: true, mensagem: "Heartbeat já enviado hoje.", deduplicado: true });
    }

    const buscarUltimo = (agente: string) => sql`
      SELECT status, created_at FROM agentes_log
      WHERE agente = ${agente}
      ORDER BY created_at DESC LIMIT 1
    ` as unknown as Promise<{ status: string; created_at: string }[]>;

    const [
      rowsNeto, rowsCarlos, rowsBernardo, rowsCard,
      rowsLisa, rowsFiscalApi, rowsWanderley, rowsBruna, rowsFelipe,
      rowsFlora, rowsDiana, rowsClara, rowsMateus,
      negocio, alertasAbertos, cardsHoje,
    ] = await Promise.all([
      buscarUltimo("neto-noticias"),
      buscarUltimo("curador-carlos"),
      buscarUltimo("bernardo-resumidor"),
      sql`
        SELECT status, created_at FROM agentes_log
        WHERE agente = 'gerador-card' AND status = 'sucesso'
        ORDER BY created_at DESC LIMIT 1
      ` as unknown as Promise<{ status: string; created_at: string }[]>,
      buscarUltimo("lisa-login"),
      buscarUltimo("andre-api"),        // corrigido: era "fiscal-api" (nome errado)
      buscarUltimo("wanderley-whatsapp"),
      buscarUltimo("bruna-banco"),
      buscarUltimo("felipe-fiscal"),
      buscarUltimo("flora-foto"),
      buscarUltimo("diana-duplicata"),
      buscarUltimo("clara-conteudo"),
      buscarUltimo("mateus-manchete"),
      sql`
        SELECT
          COUNT(*) FILTER (WHERE status = 'ativo')        AS ativos,
          COUNT(*) FILTER (WHERE status = 'trial')        AS trials,
          COUNT(*) FILTER (WHERE status = 'inadimplente') AS inadimplentes
        FROM usuarios
      `,
      sql`
        SELECT COUNT(*) AS total FROM alertas
        WHERE resolvido = false AND created_at >= NOW() - INTERVAL '24 hours'
      `,
      sql`
        SELECT g.plano, COUNT(*) AS total
        FROM posts_whatsapp pw
        JOIN grupos_whatsapp g ON g.id = pw.grupo_id
        WHERE pw.enviado_at >= ${hoje.toISOString()}
        GROUP BY g.plano
      ` as unknown as Promise<{ plano: string; total: string | number }[]>,
    ]);

    const sNeto = avaliarAgente(rowsNeto);
    const sCarlos = avaliarAgente(rowsCarlos);
    const sBernardo = avaliarAgente(rowsBernardo);
    const sCard = avaliarAgente(rowsCard);

    const sLisa = avaliarAgente(rowsLisa);
    const sFiscalApi = avaliarAgente(rowsFiscalApi);
    const sWanderley = avaliarAgente(rowsWanderley);
    const sBruna = avaliarAgente(rowsBruna);
    const sFelipe = avaliarAgente(rowsFelipe);

    const sFlora = avaliarAgente(rowsFlora);
    const sDiana = avaliarAgente(rowsDiana);
    const sClara = avaliarAgente(rowsClara);
    const sMateus = avaliarAgente(rowsMateus);

    const neg = negocio[0];
    const alertasN = Number(alertasAbertos[0].total);

    const cardsPorPlano: Record<string, number> = {};
    for (const row of cardsHoje) {
      cardsPorPlano[row.plano] = Number(row.total);
    }

    const dataHoraBRT = new Date().toLocaleString("pt-BR", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "America/Sao_Paulo",
    }).replace(",", " ·");

    const todosSaudaveis = [
      sNeto, sCarlos, sBernardo, sCard,
      sLisa, sFiscalApi, sWanderley, sBruna, sFelipe,
      sFlora, sDiana, sClara, sMateus,
    ].every(s => s.semaforo === "🟢");

    const statusGeral = alertasN === 0 && todosSaudaveis
      ? "✅ Sistema operando normalmente."
      : alertasN > 0
        ? `⚠️ ${alertasN} alerta(s) aberto(s) — verificar painel.`
        : "🟡 Subsistemas com atenção — monitorar.";

    const msg =
      `📊 <b>PAULO PING — Alerta Patriota</b>\n` +
      `📅 ${dataHoraBRT} BRT\n\n` +
      `🤖 <b>AGENTES</b>\n` +
      `${sNeto.semaforo} Neto Notícias (${formatarHora(sNeto.ultimaExecucao)})\n` +
      `${sCarlos.semaforo} Curador Carlos (${formatarHora(sCarlos.ultimaExecucao)})\n` +
      `${sBernardo.semaforo} Bernardo Resumidor (${formatarHora(sBernardo.ultimaExecucao)})\n` +
      `${sCard.semaforo} Cards Visuais (${formatarHora(sCard.ultimaExecucao)})\n\n` +
      `🏥 <b>SISTEMA</b>\n` +
      `${sLisa.semaforo} Login/Auth\n` +
      `${sFiscalApi.semaforo} API Routes\n` +
      `${sWanderley.semaforo} WhatsApp API\n` +
      `${sBruna.semaforo} Banco Neon\n` +
      `${sFelipe.semaforo} Pagamentos\n\n` +
      `🔎 <b>FISCAIS CONTEÚDO</b>\n` +
      `${sFlora.semaforo} Flora Foto\n` +
      `${sDiana.semaforo} Diana Duplicata\n` +
      `${sClara.semaforo} Clara Conteúdo\n` +
      `${sMateus.semaforo} Mateus Manchete\n\n` +
      `👥 <b>NEGÓCIO</b>\n` +
      `• Ativos: ${neg.ativos} | Trial: ${neg.trials} | Inadimplentes: ${neg.inadimplentes}\n` +
      `• Cards hoje: V:${cardsPorPlano["vip"] ?? 0} E:${cardsPorPlano["elite"] ?? 0}\n` +
      `• Alertas abertos: ${alertasN}\n\n` +
      statusGeral;

    await enviarTelegram(msg);
    await avisarDeadManSwitch();

    const duracao_ms = Date.now() - inicio;
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'paulo-ping',
        'heartbeat_diario',
        'sucesso',
        ${JSON.stringify({
          alertas_abertos: alertasN,
          negocio: { ativos: neg.ativos, trials: neg.trials, inadimplentes: neg.inadimplentes },
          cards_hoje: cardsPorPlano,
          status_geral: todosSaudaveis ? "verde" : "amarelo",
        })},
        ${duracao_ms}
      )
    `;

    return NextResponse.json({
      ok: true,
      alertas_abertos: alertasN,
      negocio: { ativos: neg.ativos, trials: neg.trials, inadimplentes: neg.inadimplentes },
      duracao_ms,
    });
  } catch (err) {
    const duracao_ms = Date.now() - inicio;
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('paulo-ping', 'heartbeat_diario', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao_ms})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
