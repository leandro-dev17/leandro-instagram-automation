import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const circuitsAtivos: string[] = [];
  const circuitsDesativados: string[] = [];

  try {
    // Conta falhas por agente na última 1h
    const falhasRecentes = await sql`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '1 hour'
        AND resolvido = false
      GROUP BY agente
    `;

    for (const row of falhasRecentes as { agente: string; total: number }[]) {
      const chave = `circuit_break_${row.agente}`;

      if (row.total >= 10) {
        // Ativa circuit break
        await sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${chave}, 'true')
          ON CONFLICT (chave) DO UPDATE SET valor = 'true'
        `;
        circuitsAtivos.push(row.agente);
        await enviarTelegram(
          `⚡ <b>Circuit Breaker ATIVADO</b>\n\nAgente: <code>${row.agente}</code>\nFalhas na última hora: ${row.total}\n\n<i>API bloqueada temporariamente.</i>`
        );
      } else if (row.total < 3) {
        // Desativa circuit break se estava ativo
        const existente = await sql`
          SELECT valor FROM app_configuracoes WHERE chave = ${chave}
        `;
        if (existente.length > 0 && existente[0].valor === "true") {
          await sql`
            UPDATE app_configuracoes SET valor = 'false' WHERE chave = ${chave}
          `;
          circuitsDesativados.push(row.agente);
          await enviarTelegram(
            `✅ <b>Circuit Breaker DESATIVADO</b>\n\nAgente: <code>${row.agente}</code>\nFalhas na última hora: ${row.total}\n\n<i>API liberada.</i>`
          );
        }
      }
    }

    await resolverFalhas("circuit-breaker");
    return NextResponse.json({ circuitsAtivos, circuitsDesativados });
  } catch (err) {
    await reportarFalha("circuit-breaker", String(err));
    return NextResponse.json({ erro: "Falha no circuit breaker", detalhes: String(err) }, { status: 500 });
  }
}
