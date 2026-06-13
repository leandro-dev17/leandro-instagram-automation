/**
 * AGENTE ULISSES UPGRADE
 * Roda toda segunda-feira. Identifica top 10% mais engajados
 * em cada grupo e manda mensagem privada sugerindo upgrade.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemPrivada } from "@/lib/whatsapp";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

const MSGS_UPGRADE: Record<string, string> = {
  vip: (nome: string) => `🎖️ *${nome}, convidamos você para o Elite Global!*\n\nCom sua dedicação ao grupo, você merece o melhor: análises globais do Prof. Bernardo Cavalcanti, Radar Econômico diário, notícias do mundo conservador (Milei, Trump, Elon) e muito mais.\n\nElite Global por R$19,90/mês: ${APP_URL}/assinar\n\n_O mundo muda para quem enxerga antes._`,
};

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Só roda às segundas
    const diaSemana = new Date().getDay();
    if (diaSemana !== 1) return NextResponse.json({ ok: true, motivo: "só roda às segundas" });

    const planos = ["vip"];
    let enviados = 0;

    for (const plano of planos) {
      const proxPlano = "elite";

      // Busca membros mais "antigos e ativos" (proxy de engajamento: mais tempo no grupo)
      const engajados = await sql`
        SELECT u.id, u.nome, u.telefone, u.plano
        FROM usuarios u
        WHERE u.plano = ${plano}
        AND u.status = 'ativo'
        AND u.telefone IS NOT NULL
        AND u.assinatura_inicio <= NOW() - INTERVAL '14 days'
        AND u.id NOT IN (
          SELECT (detalhes->>'usuarioId')::int FROM agentes_log
          WHERE agente = 'ulisses-upgrade'
          AND created_at >= NOW() - INTERVAL '30 days'
        )
        ORDER BY u.assinatura_inicio ASC
        LIMIT 5
      `;

      for (const u of engajados) {
        if (!MSGS_UPGRADE[plano]) continue;
        await enviarMensagemPrivada(u.telefone, MSGS_UPGRADE[plano](u.nome));
        await sql`
          INSERT INTO agentes_log (agente, acao, status, detalhes)
          VALUES ('ulisses-upgrade', 'sugerir_upgrade', 'sucesso',
            ${JSON.stringify({ usuarioId: u.id, planoAtual: plano, planoSugerido: proxPlano })})
        `;
        enviados++;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    return NextResponse.json({ ok: true, enviados });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
