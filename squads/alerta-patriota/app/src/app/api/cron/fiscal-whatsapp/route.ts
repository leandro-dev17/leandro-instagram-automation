/**
 * FISCAL WANDERLEY WHATSAPP — Verifica Evolution API a cada 15 min
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA || "alertapatriota";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  if (!EVO_URL || !EVO_KEY) return NextResponse.json({ ok: false, motivo: "Evolution API não configurada" });

  try {
    const res = await fetch(`${EVO_URL}/instance/connectionState/${EVO_INST}`, {
      headers: { apikey: EVO_KEY },
      signal: AbortSignal.timeout(8000),
    });

    if (!res.ok) throw new Error(`Status ${res.status}`);

    const data = await res.json();
    const estado = data?.instance?.state;

    if (estado === "connecting") {
      // Estado transitório (ex: reconectando após restart) — não é falha definitiva,
      // não dispara alerta crítico, só registra para acompanhamento.
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('wanderley-whatsapp', 'verificar_conexao', 'aviso', ${JSON.stringify({ estado, instancia: EVO_INST })})`;
    } else if (estado !== "open") {
      const { criado } = await criarAlertaDedup("fiscal_whatsapp", "critico", `WhatsApp desconectado. Estado: ${estado}`);
      if (criado) {
        await alertarTelegram("🔴", "Fiscal Wanderley WhatsApp — DESCONECTADO", `Estado atual: ${estado}\nInstância: ${EVO_INST}`);
      }
    } else {
      await sql`INSERT INTO agentes_log (agente, acao, status, detalhes) VALUES ('wanderley-whatsapp', 'verificar_conexao', 'sucesso', ${JSON.stringify({ estado, instancia: EVO_INST })})`;
    }

    return NextResponse.json({ ok: estado === "open", estado });
  } catch (err) {
    const { criado } = await criarAlertaDedup("fiscal_whatsapp", "critico", "Evolution API não responde").catch(() => ({ criado: false }));
    if (criado) {
      await alertarTelegram("🚨", "Fiscal Wanderley WhatsApp — EVOLUTION API FORA DO AR", String(err));
    }
    return NextResponse.json({ ok: false, erro: String(err) }, { status: 503 });
  }
}
