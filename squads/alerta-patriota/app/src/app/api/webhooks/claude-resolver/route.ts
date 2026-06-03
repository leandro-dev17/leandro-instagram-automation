/**
 * CLAUDE RESOLVER — Penúltimo recurso da hierarquia
 *
 * Fluxo correto:
 * Fiscal → Gerente → CEO → Claude Resolver (tenta auto-fix) → Leandro (último recurso)
 *
 * Este endpoint:
 * 1. Recebe o problema do CEO
 * 2. Tenta auto-fix automaticamente conforme o tipo de problema
 * 3. Se auto-fix resolver → registra e pronto (Leandro não é incomodado)
 * 4. Se NÃO resolver → aí sim alerta Leandro via Telegram com contexto completo
 *    + instrução para acionar Claude Code manualmente
 *
 * Os commits fix(auto): são Claude Code sendo invocado manualmente por Leandro
 * ou semi-automaticamente via BioNexus Digital.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram } from "@/lib/telegram";

const APP_URL   = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

const MAPA_ARQUIVOS: Record<string, string> = {
  cards_sem_envio:       "squads/alerta-patriota/automation/whatsapp-cards.cjs",
  cards_com_erro:        "squads/alerta-patriota/automation/whatsapp-cards.cjs",
  pipeline_incompleta:   "squads/alerta-patriota/app/src/app/api/cron/ (pipeline)",
  conteudo_irrelevante:  "squads/alerta-patriota/app/src/app/api/cron/curar-noticias/route.ts",
  workflow_falhando:     ".github/workflows/alerta-patriota-crons.yml",
  fonte_rss_inativa:     "squads/alerta-patriota/app/src/app/api/cron/coletar-noticias/route.ts",
  estoque_critico:       "squads/alerta-patriota/app/src/app/api/cron/curar-noticias/route.ts",
  duplicata_detectada:   "squads/alerta-patriota/app/src/app/api/cron/publicar-noticias/route.ts",
};

// Auto-fixes que Claude Resolver pode tentar sem intervenção humana
async function tentarAutoFix(tipo: string): Promise<{ ok: boolean; acao: string }> {
  const h = { Authorization: `Bearer ${CRON_SECRET}` };
  try {
    if (tipo === "estoque_critico" || tipo === "pipeline_incompleta") {
      await fetch(`${APP_URL}/api/cron/coletar-noticias`, { headers: h, signal: AbortSignal.timeout(15000) });
      await new Promise(r => setTimeout(r, 3000));
      await fetch(`${APP_URL}/api/cron/curar-noticias`, { headers: h, signal: AbortSignal.timeout(15000) });
      await new Promise(r => setTimeout(r, 3000));
      await fetch(`${APP_URL}/api/cron/resumir-noticias`, { headers: h, signal: AbortSignal.timeout(15000) });
      return { ok: true, acao: "Pipeline reativada: coletar + curar + resumir acionados" };
    }
    if (tipo === "conteudo_irrelevante") {
      await fetch(`${APP_URL}/api/cron/curar-noticias`, { headers: h, signal: AbortSignal.timeout(15000) });
      return { ok: true, acao: "Curador Carlos re-acionado com filtro" };
    }
    if (tipo === "cards_sem_envio") {
      // Cards precisam de Puppeteer/GitHub Actions — não dá auto-fix aqui
      return { ok: false, acao: "Cards visuais requerem GitHub Actions (Puppeteer) — não é possível auto-fix via API" };
    }
    if (tipo === "workflow_falhando") {
      return { ok: false, acao: "Falha no GitHub Actions requer análise de código" };
    }
  } catch (e) {
    return { ok: false, acao: `Auto-fix falhou: ${String(e).substring(0, 100)}` };
  }
  return { ok: false, acao: "Nenhum auto-fix disponível para este tipo de problema" };
}

export async function POST(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const body = await req.json() as {
      agente?: string; erro?: string; tipo?: string;
      tentativas?: number; dados?: Record<string, unknown>;
    };
    const { agente = "desconhecido", erro = "sem detalhes", tipo = "", tentativas = 1 } = body;

    // 1. Tenta auto-fix antes de incomodar Leandro
    const fix = await tentarAutoFix(tipo);

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('claude-resolver', 'tentativa_autofix', ${fix.ok ? "sucesso" : "aviso"},
        ${JSON.stringify({ agente, tipo, erro, fix })})
    `;

    if (fix.ok) {
      // Auto-fix funcionou → NÃO alerta Leandro
      await enviarTelegram(
        `🔧 *CLAUDE RESOLVER — Auto-fix aplicado*\n\n` +
        `Problema: ${erro.substring(0, 80)}\n` +
        `✅ Correção: ${fix.acao}\n\n` +
        `_Leandro não precisa intervir._`
      );
      return NextResponse.json({ ok: true, autoFix: true, acao: fix.acao });
    }

    // 2. Auto-fix não resolveu → agora sim alerta Leandro
    const alertasAbertos = await sql`
      SELECT tipo, severidade, mensagem, created_at FROM alertas
      WHERE resolvido = false AND severidade IN ('critico', 'alto')
      ORDER BY created_at DESC LIMIT 8
    `;

    const listaAlertas = alertasAbertos.map(a => {
      const al = a as { tipo: string; mensagem: string; created_at: string };
      const arquivo = MAPA_ARQUIVOS[al.tipo] ?? "arquivo não mapeado";
      const min = Math.round((Date.now() - new Date(al.created_at).getTime()) / 60000);
      return `• *${al.tipo}* (${min}min)\n  ${al.mensagem.substring(0, 80)}\n  📁 \`${arquivo}\``;
    }).join("\n\n");

    await enviarTelegram(
      `🆘 *CLAUDE RESOLVER → LEANDRO* — Intervenção necessária\n` +
      `━━━━━━━━━━━━━━━━━━━\n\n` +
      `Agente: ${agente} | Tentativas: ${tentativas}\n` +
      `Problema: ${erro.substring(0, 100)}\n` +
      `Auto-fix tentado: ${fix.acao}\n\n` +
      (alertasAbertos.length > 0
        ? `*Alertas abertos (${alertasAbertos.length}):*\n${listaAlertas}\n\n`
        : "") +
      `━━━━━━━━━━━━━━━━━━━\n` +
      `*Como resolver:*\nAbra o Claude Code e execute:\n` +
      `\`/BioNexus Digital\`\n\n` +
      `O Claude analisará os logs, identificará a causa raiz e commitará o fix:\n` +
      `\`fix(auto): guardião corrigiu falha detectada [timestamp]\``
    );

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('claude-resolver', 'escalacao_leandro', 'aviso',
        ${JSON.stringify({ agente, erro, tipo, alertas: alertasAbertos.length })})
    `;

    return NextResponse.json({ ok: false, autoFix: false, escaladoLeandro: true, acao: fix.acao });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
