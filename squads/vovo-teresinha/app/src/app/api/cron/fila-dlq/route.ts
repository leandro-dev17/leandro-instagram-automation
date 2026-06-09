import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  let processadas = 0;
  let criticas = 0;

  try {
    // Busca falhas antigas não resolvidas com tentativas < 5
    const falhas = await sql`
      SELECT id, agente, erro, tentativas
      FROM falhas_agentes
      WHERE resolvido = false
        AND criado_em < NOW() - INTERVAL '4 hours'
        AND tentativas < 5
    `;

    const criticasLista: string[] = [];
    const processadasLista: string[] = [];

    for (const falha of falhas as { id: number; agente: string; erro: string; tentativas: number }[]) {
      const novasTentativas = falha.tentativas + 1;

      if (novasTentativas >= 5) {
        // Marca como resolvida (esgotou tentativas)
        await sql`
          UPDATE falhas_agentes
          SET tentativas = ${novasTentativas}, resolvido = true, resolvido_em = NOW()
          WHERE id = ${falha.id}
        `;
        criticas++;
        criticasLista.push(`❌ ${falha.agente}: ${falha.erro.substring(0, 100)}`);
      } else {
        // Incrementa tentativas
        await sql`
          UPDATE falhas_agentes
          SET tentativas = ${novasTentativas}
          WHERE id = ${falha.id}
        `;
        processadas++;
        processadasLista.push(`🔄 ${falha.agente} (tentativa ${novasTentativas}/5)`);
      }
    }

    if (falhas.length > 0) {
      const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
      let msg = `📬 <b>Dead Letter Queue — ${hora}</b>\n\n`;

      if (processadasLista.length > 0) {
        msg += `<b>Re-processadas (${processadas}):</b>\n${processadasLista.join("\n")}\n\n`;
      }

      if (criticasLista.length > 0) {
        msg += `<b>🚨 Críticas — esgotaram tentativas (${criticas}):</b>\n${criticasLista.join("\n")}\n\n`;
        msg += `<i>Estas falhas foram fechadas por esgotamento. Revisão manual necessária.</i>`;
      }

      await enviarTelegram(msg);
    }

    await resolverFalhas("fila-dlq");
    return NextResponse.json({ processadas, criticas });
  } catch (err) {
    await reportarFalha("fila-dlq", String(err));
    return NextResponse.json({ erro: "Falha na DLQ", detalhes: String(err) }, { status: 500 });
  }
}
