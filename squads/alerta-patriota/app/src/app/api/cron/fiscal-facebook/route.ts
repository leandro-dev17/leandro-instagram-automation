/**
 * FISCAL FACEBOOK — Verifica E renova tokens Facebook/Instagram automaticamente
 * Renova antes de vencer (< 10 dias para expirar) sem precisar de intervenção.
 * Usa Vercel API e GitHub Secrets API para atualizar os tokens automaticamente.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram, enviarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const FB_API        = "https://graph.facebook.com/v21.0";
const FB_PAGE_TOKEN = process.env.FB_PAGE_TOKEN || "";
const FB_APP_ID     = process.env.FB_APP_ID || "";
const FB_APP_SECRET = process.env.FB_APP_SECRET || "";
const VERCEL_TOKEN  = process.env.VERCEL_TOKEN || "";
const VERCEL_PROJECT_ID = process.env.VERCEL_PROJECT_ID || "prj_ZYN6c2dhVL3oYGh00URkGot0bMO3";
const VERCEL_TEAM_ID    = process.env.VERCEL_TEAM_ID    || "team_JnDwQYGSI9RBjHyIygKLR56b";

// ── Verifica token via debug_token ────────────────────────────────────────────
async function verificarToken(token: string): Promise<{ valido: boolean; diasRestantes: number; expira: string }> {
  if (!token) return { valido: false, diasRestantes: 0, expira: "N/A" };
  try {
    const res = await fetch(
      `${FB_API}/debug_token?input_token=${token}&access_token=${token}`,
      { signal: AbortSignal.timeout(8000) }
    );
    const data = await res.json();
    if (!data.data?.is_valid) return { valido: false, diasRestantes: 0, expira: "expirado" };

    const expiresAt = data.data.expires_at;
    if (!expiresAt) return { valido: true, diasRestantes: 9999, expira: "Nunca (permanente)" };

    const diasRestantes = Math.floor((expiresAt * 1000 - Date.now()) / 86400000);
    const expira = new Date(expiresAt * 1000).toLocaleDateString("pt-BR");
    return { valido: true, diasRestantes, expira };
  } catch {
    return { valido: false, diasRestantes: 0, expira: "erro na verificação" };
  }
}

// ── Renova token de longa duração (60 dias) ───────────────────────────────────
async function renovarToken(tokenAtual: string): Promise<string | null> {
  if (!FB_APP_ID || !FB_APP_SECRET) return null;
  try {
    const res = await fetch(
      `${FB_API}/oauth/access_token?grant_type=fb_exchange_token&client_id=${FB_APP_ID}&client_secret=${FB_APP_SECRET}&fb_exchange_token=${tokenAtual}`,
      { signal: AbortSignal.timeout(10000) }
    );
    const data = await res.json();
    return data.access_token || null;
  } catch { return null; }
}

// FASE 27.6: atualizarVercel() só fazia PATCH/POST na env var — a Vercel não reaplica env vars em
// deployments já existentes, só nos próximos. Sem redeploy, o token novo (já trocado no Vercel)
// ficava sem efeito real em produção até o próximo deploy natural do projeto, uma janela onde
// o código continuava rodando com o token antigo prestes a vencer. Mesmo helper de redeploy
// usado por claude-revisor/route.ts (redeploya o último build de produção, sem precisar de novo commit).
async function redeploy(): Promise<boolean> {
  if (!VERCEL_TOKEN) return false;
  try {
    const r = await fetch(`https://api.vercel.com/v6/deployments?projectId=${VERCEL_PROJECT_ID}&teamId=${VERCEL_TEAM_ID}&limit=1&target=production`, {
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(6000),
    });
    const d = await r.json();
    const last = d.deployments?.[0];
    if (!last) return false;

    const deploy = await fetch(`https://api.vercel.com/v13/deployments?teamId=${VERCEL_TEAM_ID}&forceNew=1`, {
      method: "POST",
      headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: last.name, deploymentId: last.uid, target: "production" }),
      signal: AbortSignal.timeout(10000),
    });
    return deploy.ok;
  } catch { return false; }
}

// ── Atualiza env var no Vercel ─────────────────────────────────────────────────
async function atualizarVercel(key: string, value: string): Promise<boolean> {
  if (!VERCEL_TOKEN) return false;
  try {
    // Busca ID da var existente
    const list = await fetch(
      `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
      { headers: { Authorization: `Bearer ${VERCEL_TOKEN}` }, signal: AbortSignal.timeout(8000) }
    );
    const listData = await list.json();
    const envVar = listData.envs?.find((e: { key: string }) => e.key === key);

    const body = JSON.stringify({ value, type: "encrypted", target: ["production"] });

    if (envVar?.id) {
      // Atualiza existente
      const res = await fetch(
        `https://api.vercel.com/v9/projects/${VERCEL_PROJECT_ID}/env/${envVar.id}?teamId=${VERCEL_TEAM_ID}`,
        { method: "PATCH", headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" }, body, signal: AbortSignal.timeout(8000) }
      );
      return res.ok;
    } else {
      // Cria nova
      const res = await fetch(
        `https://api.vercel.com/v10/projects/${VERCEL_PROJECT_ID}/env?teamId=${VERCEL_TEAM_ID}`,
        { method: "POST", headers: { Authorization: `Bearer ${VERCEL_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ key, value, type: "encrypted", target: ["production"] }), signal: AbortSignal.timeout(8000) }
      );
      return res.ok;
    }
  } catch { return false; }
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  const inicio = Date.now();

  try {
    if (!FB_PAGE_TOKEN) {
      return NextResponse.json({ ok: false, motivo: "Credenciais Facebook não configuradas" });
    }

    const status = await verificarToken(FB_PAGE_TOKEN);

    // ── TOKEN INVÁLIDO ──────────────────────────────────────────────────────
    if (!status.valido) {
      // FASE 17: sem dedup, cada execução deste cron com token inválido reenviava
      // o mesmo alerta Telegram e inserção em `alertas` até alguém trocar o token.
      const { criado } = await criarAlertaDedup("fiscal_facebook", "critico", "Token Facebook inválido — renovação manual necessária");
      if (criado) {
        await alertarTelegram("🔴", "FACEBOOK FISCAL — TOKEN INVÁLIDO",
          "O token da página Facebook/Instagram expirou.\n" +
          "Não foi possível renovar automaticamente.\n" +
          "Ação: gere novo token em developers.facebook.com e atualize ALERTA_FB_PAGE_TOKEN."
        );
      }
      return NextResponse.json({ ok: false, diasRestantes: 0, renovado: false });
    }

    // ── TOKEN PRÓXIMO DO VENCIMENTO (< 10 dias) → RENOVA AUTOMATICAMENTE ───
    if (status.diasRestantes < 10 && status.diasRestantes !== 9999) {
      const novoToken = await renovarToken(FB_PAGE_TOKEN);

      if (novoToken) {
        // Atualiza Vercel automaticamente
        const vercelOk = await atualizarVercel("FB_PAGE_TOKEN", novoToken);
        // Item 20 (Fase 30): redeploy() existia mas nunca era chamada — a env var nova
        // ficava salva no Vercel, mas só valeria a partir do próximo deploy natural do
        // projeto (a Vercel não reaplica env vars em deployments já existentes), deixando
        // o token antigo prestes a vencer em produção mesmo após uma "renovação bem-sucedida".
        const redeployOk = vercelOk ? await redeploy() : false;

        await sql`
          INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
          VALUES ('fiscal-facebook', 'renovar_token', 'sucesso',
            ${JSON.stringify({ diasAntes: status.diasRestantes, vercelAtualizado: vercelOk, redeployAcionado: redeployOk })},
            ${Date.now() - inicio})
        `;

        // Leandro recebe RELATÓRIO de sucesso (não alerta)
        await enviarTelegram(
          `✅ *FACEBOOK FISCAL — Token Renovado Automaticamente*\n\n` +
          `O token Facebook/Instagram foi renovado antes de vencer.\n` +
          `Dias restantes antes: ${status.diasRestantes}\n` +
          `Novo token válido por mais 60 dias.\n` +
          `Vercel atualizado: ${vercelOk ? "✅" : "⚠️ falhou — verifique manualmente"}\n` +
          `Redeploy acionado: ${redeployOk ? "✅" : "⚠️ falhou — env var nova só entra em vigor no próximo deploy manual"}\n\n` +
          `_Nenhuma ação necessária._`
        );

        return NextResponse.json({ ok: true, renovado: true, diasRestantes: status.diasRestantes, vercelOk, redeployOk });
      } else {
        // Tentativa de renovação falhou
        const { criado } = await criarAlertaDedup("fiscal_facebook", "alto", `Token Facebook vence em ${status.diasRestantes} dias — renovação automática falhou`);
        if (criado) {
          await alertarTelegram("🟡", "FACEBOOK FISCAL — Renovação Falhou",
            `Token vence em ${status.diasRestantes} dias.\n` +
            "Renovação automática falhou (faltam FB_APP_ID e FB_APP_SECRET?).\n" +
            "Renove manualmente em developers.facebook.com."
          );
        }
        return NextResponse.json({ ok: true, renovado: false, diasRestantes: status.diasRestantes });
      }
    }

    // ── TOKEN OK ─────────────────────────────────────────────────────────────
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('fiscal-facebook', 'verificar_token', 'sucesso',
        ${JSON.stringify({ valido: true, diasRestantes: status.diasRestantes, expira: status.expira })},
        ${Date.now() - inicio})
    `;

    return NextResponse.json({ ok: true, renovado: false, diasRestantes: status.diasRestantes, expira: status.expira });
  } catch (err) {
    await alertarTelegram("🔴", "FACEBOOK FISCAL — Erro crítico", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
