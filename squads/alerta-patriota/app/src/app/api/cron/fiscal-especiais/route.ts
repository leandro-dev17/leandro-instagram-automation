/**
 * VERA VERIFICAÇÃO — Fiscal de publicações especiais periódicas
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL!;
const CRON_SECRET = process.env.CRON_SECRET!;

function agora(): { brt: Date; diaSemana: number; hora: number } {
  const brt = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return { brt, diaSemana: brt.getDay(), hora: brt.getHours() };
}

function inicioHojeBRT(brt: Date): string {
  const d = new Date(brt);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

function ultimoSabado(brt: Date): string {
  const d = new Date(brt);
  const dia = d.getDay();
  const diasAtrás = dia === 0 ? 1 : dia === 6 ? 0 : dia + 1;
  d.setDate(d.getDate() - diasAtrás);
  d.setHours(0, 0, 0, 0);
  return d.toISOString();
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const { brt, diaSemana, hora } = agora();
  const hoje = inicioHojeBRT(brt);

  const resultado: Record<string, unknown> = { diaSemana, hora };

  try {
    // DOMINGO (0) — Termômetro da Tereza
    if (diaSemana === 0) {
      const rows = await sql`
        SELECT id FROM agentes_log
        WHERE agente = 'tereza-termometro'
          AND status = 'sucesso'
          AND created_at >= ${hoje}::timestamptz
        LIMIT 1
      `;
      const enviado = rows.length > 0;
      resultado.termometro = { esperado: true, enviado };

      if (!enviado && hora >= 21) {
        await sql`
          INSERT INTO alertas (tipo, severidade, mensagem)
          VALUES ('publicacao_especial_ausente', 'critico', 'Termômetro político não enviado no domingo — hora já passou das 21h BRT')
        `;
        await alertarTelegram(
          "🚨",
          "VERA VERIFICAÇÃO — Termômetro NÃO enviado!",
          "Domingo após 21h BRT e o <b>Termômetro da Tereza</b> ainda não foi enviado!\n\nAcionar manualmente: /api/cron/termometro"
        );
      }
    }

    // SEGUNDA (1) — Análise Semanal VIP
    if (diaSemana === 1) {
      const rows = await sql`
        SELECT id FROM agentes_log
        WHERE agente = 'analise-semanal-vip'
          AND status = 'sucesso'
          AND created_at >= ${hoje}::timestamptz
        LIMIT 1
      `;
      const enviado = rows.length > 0;
      resultado.analiseSemanal = { esperado: true, enviado };

      if (!enviado && hora >= 10) {
        await sql`
          INSERT INTO alertas (tipo, severidade, mensagem)
          VALUES ('publicacao_especial_ausente', 'alto', 'Análise Semanal VIP não enviada na segunda — hora já passou das 10h BRT')
        `;
        await alertarTelegram(
          "🔴",
          "VERA VERIFICAÇÃO — Análise Semanal VIP ausente",
          "Segunda-feira após 10h BRT e a <b>Análise Semanal VIP</b> ainda não foi enviada.\n\nAcionar: /api/cron/analise-semanal-vip"
        );
      }
    }

    // SÁBADO (6) — Dossiê Elite
    if (diaSemana === 6) {
      const rows = await sql`
        SELECT id FROM agentes_log
        WHERE agente = 'davi-dossie'
          AND status = 'sucesso'
          AND created_at >= ${hoje}::timestamptz
        LIMIT 1
      `;
      const enviado = rows.length > 0;
      resultado.dossieElite = { esperado: true, enviado };

      if (!enviado && hora >= 12) {
        await sql`
          INSERT INTO alertas (tipo, severidade, mensagem)
          VALUES ('publicacao_especial_ausente', 'alto', 'Dossiê Elite não enviado no sábado — hora já passou das 12h BRT')
        `;
        await alertarTelegram(
          "🔴",
          "VERA VERIFICAÇÃO — Dossiê Elite ausente — acionando auto-fix",
          "Sábado após 12h BRT e o <b>Dossiê Elite</b> ainda não foi enviado.\n\nAcionando Davi Dossiê automaticamente..."
        );

        try {
          await fetch(`${APP_URL}/api/cron/dossie-elite`, {
            method: "POST",
            headers: { Authorization: `Bearer ${CRON_SECRET}` },
          });
          resultado.dossieAutoFix = "acionado";
        } catch {
          resultado.dossieAutoFix = "falhou";
        }
      }
    }

    // QUALQUER DIA — Verifica se o dossiê do sábado passado foi enviado
    const sabPassado = ultimoSabado(brt);
    const sabPassadoFim = new Date(new Date(sabPassado).getTime() + 24 * 60 * 60 * 1000).toISOString();

    const rowsSabPassado = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'davi-dossie'
        AND status = 'sucesso'
        AND created_at >= ${sabPassado}::timestamptz
        AND created_at < ${sabPassadoFim}::timestamptz
      LIMIT 1
    `;
    resultado.dossieUltimoSabado = {
      data: sabPassado.slice(0, 10),
      enviado: rowsSabPassado.length > 0,
    };

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'vera-verificacao',
        'verificar_especiais',
        'sucesso',
        ${JSON.stringify(resultado)},
        ${duracao}
      )
    `;

    return NextResponse.json({ ok: true, ...resultado, duracao_ms: duracao });
  } catch (err) {
    await alertarTelegram("🚨", "VERA VERIFICAÇÃO — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
