/**
 * AGENTE MÁRIO MÉDICO — Auto-cura de serviços com falha
 * Acionado pelos fiscais via Telegram ou direto quando detectam problema.
 * Protocolo por serviço com backoff exponencial.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

// Sem maxDuration, a Vercel mata a função em 10s por padrão — quando servico="all" (caso
// default), curarBanco (até 31s de backoff) + curarWhatsApp (até 36s) rodam em sequência
// e o pior caso somava ~67s, bem acima de qualquer teto. maxDuration=60 (limite do plano
// Hobby) + backoffs reduzidos abaixo deixam o pior caso real em ~39s, com margem.
export const maxDuration = 60;

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || "alertapatriota";
const APP_URL  = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

async function curarBanco(): Promise<boolean> {
  for (let i = 0; i < 4; i++) {
    try {
      await sql`SELECT 1`;
      return true;
    } catch {
      await new Promise(r => setTimeout(r, Math.min(Math.pow(2, i), 8) * 1000));
    }
  }
  return false;
}

async function curarWhatsApp(): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY) return false;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(`${EVO_URL}/instance/connect/${EVO_INST}`, {
        headers: { apikey: EVO_KEY },
        signal: AbortSignal.timeout(6000),
      });
      if (res.ok) return true;
    } catch {
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const servico = searchParams.get("servico") || "all";
  const resultados: Record<string, boolean> = {};

  try {
    if (servico === "banco" || servico === "all") {
      const ok = await curarBanco();
      resultados.banco = ok;
      // FASE 23: chamado repetidamente pelos fiscais via claude-resolver enquanto o
      // problema persistir, sem dedup gerava um Telegram novo a cada acionamento.
      if (!ok) {
        const { criado } = await criarAlertaDedup("medico_falha_banco", "critico", "Auto-cura do banco falhou após 5 tentativas");
        if (criado) await alertarTelegram("🚨", "Mário Médico — NÃO CUROU o banco", "Neon não responde após 5 tentativas. Verificar console.neon.tech");
      }
    }

    if (servico === "whatsapp" || servico === "all") {
      const ok = await curarWhatsApp();
      resultados.whatsapp = ok;
      if (!ok) {
        const { criado } = await criarAlertaDedup("medico_falha_whatsapp", "critico", "Auto-cura do WhatsApp falhou");
        if (criado) await alertarTelegram("🚨", "Mário Médico — NÃO CUROU WhatsApp", "Evolution API não reconecta. Acesse o manager para escanear QR.");
      }
    }

    // Registra resultado
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('agente-medico', 'auto_cura', ${Object.values(resultados).every(Boolean) ? 'sucesso' : 'erro'},
        ${JSON.stringify({ servico, resultados })})
    `.catch(() => {});

    return NextResponse.json({ ok: true, resultados });
  } catch (err) {
    await alertarTelegram("🚨", "Mário Médico — ERRO CRÍTICO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
