/**
 * GUARDIÃO 24/7 — Monitor de Saúde da Automação
 *
 * Executado a cada 15 minutos via GitHub Actions.
 * Cadeia de escalação em 3 níveis:
 *   Nível 1 — Auto-correção imediata (fixes leves e conhecidos)
 *   Nível 2 — Claude Anthropic (claude-revisor: lê código, gera fix, commita, redeploy)
 *   Nível 3 — Telegram ao dono (intervenção humana, última instância)
 *
 * Checks rápidos (< 5s total):
 *   - Latência do banco Neon
 *   - Taxa de falhas críticas nos últimos 15 min
 *   - Fila WhatsApp represada
 *   - Inconsistência premium/assinatura
 *   - Backlog total de falhas abertas
 */
import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";

const APP  = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

// Dedup: evita alertas repetidos para o mesmo problema dentro de 30 min
async function jaAlertouRecente(sql: ReturnType<typeof neon>, chave: string): Promise<boolean> {
  try {
    const rows = await sql`
      SELECT 1 FROM app_configuracoes
      WHERE chave = ${chave}
        AND atualizado_em > NOW() - INTERVAL '30 minutes'
      LIMIT 1
    ` as unknown[];
    return rows.length > 0;
  } catch { return false; }
}

async function registrarAlerta(sql: ReturnType<typeof neon>, chave: string) {
  try {
    await sql`
      INSERT INTO app_configuracoes (chave, valor, atualizado_em)
      VALUES (${chave}, ${new Date().toISOString()}, NOW())
      ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atualizado_em = NOW()
    `;
  } catch { /* silencioso */ }
}

// Conta tentativas do claude-revisor nas últimas 2h (dedup para escalar ao humano)
async function tentativasClaude(sql: ReturnType<typeof neon>): Promise<number> {
  try {
    const rows = await sql`
      SELECT COUNT(*)::int AS total FROM falhas_agentes
      WHERE agente = 'claude-revisor'
        AND criado_em > NOW() - INTERVAL '2 hours'
    ` as { total: number }[];
    return Number(rows[0]?.total ?? 0);
  } catch { return 0; }
}

async function dispararCronAuth(rota: string): Promise<boolean> {
  try {
    const res = await fetch(`${APP}${rota}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${CRON}` },
      signal: AbortSignal.timeout(10000),
    });
    return res.ok;
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const sql = neon(process.env.DATABASE_URL!);
  const problemas: { nivel: number; descricao: string; acao: string }[] = [];
  const inicio = Date.now();

  try {
    // ── CHECK 1: LATÊNCIA DO BANCO ──────────────────────────────────────────
    const t0 = Date.now();
    try {
      await sql`SELECT 1 AS ping`;
    } catch {
      if (!(await jaAlertouRecente(sql, "g247_db_down"))) {
        await registrarAlerta(sql, "g247_db_down");
        problemas.push({ nivel: 3, descricao: "Banco Neon INACESSÍVEL", acao: "telegram" });
      }
    }
    const latencia = Date.now() - t0;

    if (latencia > 3000 && !(await jaAlertouRecente(sql, "g247_db_lento"))) {
      await registrarAlerta(sql, "g247_db_lento");
      problemas.push({ nivel: 2, descricao: `Banco lento: ${latencia}ms (> 3000ms)`, acao: "claude-revisor" });
    }

    // ── CHECK 2: FALHAS CRÍTICAS NOS ÚLTIMOS 15 MIN ─────────────────────────
    const falhasRecentes = await sql`
      SELECT agente, COUNT(*)::int AS total
      FROM falhas_agentes
      WHERE resolvido = false
        AND criado_em > NOW() - INTERVAL '15 minutes'
      GROUP BY agente
      HAVING COUNT(*) >= 3
      ORDER BY total DESC
      LIMIT 5
    ` as { agente: string; total: number }[];

    if (falhasRecentes.length > 0) {
      const resumo = falhasRecentes
        .map((r) => `${r.agente} (${r.total}x)`)
        .join(", ");
      const chave = `g247_falhas_${falhasRecentes[0].agente}`;
      if (!(await jaAlertouRecente(sql, chave))) {
        await registrarAlerta(sql, chave);
        problemas.push({ nivel: 2, descricao: `Agentes com 3+ falhas nos últimos 15min: ${resumo}`, acao: "claude-revisor" });
      }
    }

    // ── CHECK 3: FILA WHATSAPP REPRESADA ────────────────────────────────────
    const filaWpp = await sql`
      SELECT COUNT(*)::int AS total FROM whatsapp_fila
      WHERE enviado = false
        AND agendado_para < NOW() - INTERVAL '30 minutes'
    ` as { total: number }[];
    const qtdFila = Number(filaWpp[0]?.total ?? 0);

    if (qtdFila > 50 && !(await jaAlertouRecente(sql, "g247_wpp_fila"))) {
      await registrarAlerta(sql, "g247_wpp_fila");
      // Auto-fix nível 1: re-dispara o whatsapp-fila
      await dispararCronAuth("/api/cron/whatsapp-fila");
      problemas.push({ nivel: 1, descricao: `Fila WPP represada: ${qtdFila} mensagens pendentes há +30min`, acao: "auto-fix: whatsapp-fila disparado" });
    }

    // ── CHECK 4: PREMIUM SEM ASSINATURA ATIVA ───────────────────────────────
    const premiumSemAss = await sql`
      SELECT COUNT(*)::int AS total
      FROM usuarios u
      WHERE u.tipo_usuario = 'premium'
        AND NOT EXISTS (
          SELECT 1 FROM assinaturas a
          WHERE a.usuario_id = u.id AND a.status = 'ativo'
        )
    ` as { total: number }[];
    const qtdPremiumSemAss = Number(premiumSemAss[0]?.total ?? 0);

    if (qtdPremiumSemAss > 0 && !(await jaAlertouRecente(sql, "g247_premium_sem_ass"))) {
      await registrarAlerta(sql, "g247_premium_sem_ass");
      // Auto-fix nível 1: dispara fiscal-pagamentos que tem auto-correção
      await dispararCronAuth("/api/cron/fiscal-pagamentos");
      problemas.push({ nivel: 1, descricao: `${qtdPremiumSemAss} usuários premium sem assinatura ativa`, acao: "auto-fix: fiscal-pagamentos disparado" });
    }

    // ── CHECK 5: BACKLOG TOTAL DE FALHAS ────────────────────────────────────
    const [backlog] = await sql`
      SELECT COUNT(*)::int AS total FROM falhas_agentes WHERE resolvido = false
    ` as { total: number }[];
    const totalFalhas = Number(backlog?.total ?? 0);

    if (totalFalhas > 30 && !(await jaAlertouRecente(sql, "g247_backlog_alto"))) {
      await registrarAlerta(sql, "g247_backlog_alto");
      problemas.push({ nivel: 2, descricao: `Backlog crítico: ${totalFalhas} falhas abertas (> 30)`, acao: "claude-revisor" });
    }

    // ── CHECK 6: TRIALS VENCIDOS SEM CONVERSÃO ──────────────────────────────
    const trialsVencidos = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
      WHERE tipo_usuario = 'trial' AND trial_fim < NOW()
    ` as { total: number }[];
    const qtdTrials = Number(trialsVencidos[0]?.total ?? 0);

    if (qtdTrials > 0 && !(await jaAlertouRecente(sql, "g247_trials_vencidos"))) {
      await registrarAlerta(sql, "g247_trials_vencidos");
      // Auto-fix nível 1: dispara agente-assinaturas
      await dispararCronAuth("/api/cron/agente-assinaturas");
      problemas.push({ nivel: 1, descricao: `${qtdTrials} trials vencidos não convertidos`, acao: "auto-fix: agente-assinaturas disparado" });
    }

    // ── ESCALAÇÃO ────────────────────────────────────────────────────────────

    const nivel1 = problemas.filter(p => p.nivel === 1);
    const nivel2 = problemas.filter(p => p.nivel === 2);
    const nivel3 = problemas.filter(p => p.nivel === 3);

    // Nível 2 → Claude Revisor (se ainda não tentou 2x nas últimas 2h)
    if (nivel2.length > 0) {
      const tentativas = await tentativasClaude(sql);
      if (tentativas < 2) {
        await dispararCronAuth("/api/cron/claude-revisor");
      } else {
        // Claude já tentou 2x — escala para o dono
        nivel3.push(...nivel2.map(p => ({ ...p, nivel: 3 })));
      }
    }

    // Nível 3 → Telegram ao dono
    if (nivel3.length > 0) {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      const lista = nivel3.map(p => `❗ ${p.descricao}\n   Ação: ${p.acao}`).join("\n\n");
      await enviarTelegram(
        `🚨 <b>GUARDIÃO 24/7 — INTERVENÇÃO NECESSÁRIA (${hora})</b>\n\n` +
        `Os sistemas abaixo <b>não puderam ser corrigidos automaticamente</b>:\n\n` +
        lista +
        `\n\n⚙️ Claude Anthropic já tentou 2x sem sucesso. Ação humana necessária.\n` +
        `🔗 <a href="${APP}/admin">Acessar painel admin</a>`
      );
    }

    // Relatório silencioso quando tudo OK (sem Telegram para não poluir)
    const ms = Date.now() - inicio;
    const status = problemas.length === 0 ? "ok" : "alertas";

    return NextResponse.json({
      ok: true,
      status,
      latencia_db_ms: latencia,
      ms_total: ms,
      problemas: problemas.length,
      nivel1: nivel1.length,
      nivel2: nivel2.length,
      nivel3: nivel3.length,
      detalhes: problemas,
    });

  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[guardiao-24-7] Erro crítico:", msg);

    // Erro no próprio guardião → Telegram imediato (sem dedup — é emergência)
    await enviarTelegram(
      `🆘 <b>GUARDIÃO 24/7 — ERRO CRÍTICO</b>\n\n` +
      `O guardião em si falhou e não pode monitorar o sistema.\n\n` +
      `<code>${msg.slice(0, 300)}</code>\n\n` +
      `Verifique os logs da Vercel imediatamente.`
    ).catch(() => {});

    return NextResponse.json({ erro: msg }, { status: 500 });
  }
}
