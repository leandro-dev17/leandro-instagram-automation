/**
 * FISCAL LÚCIA LÓGICA — Fiscal de Lógica de Negócios
 * Verifica regras de negócio do app: receitas, favoritos, assinaturas, trial, fila WhatsApp.
 * Se detectar anomalia → grava em falhas_agentes e aciona revisor-logica.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { alertarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const APP = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON = process.env.CRON_SECRET || "";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const falhas: string[] = [];

  try {
    // 1. Receitas disponíveis (banco não pode estar vazio)
    const [receitasTotal] = await sql`SELECT COUNT(*)::int AS total FROM receitas`;
    if (Number(receitasTotal.total) < 5) {
      falhas.push(`Apenas ${receitasTotal.total} receitas no banco (mínimo esperado: 5)`);
    }

    // 2. Assinaturas com status inválido (devem ser: ativo, cancelado, trial, expirada, pendente)
    const statusInvalidos = await sql`
      SELECT status, COUNT(*)::int AS total FROM assinaturas
      WHERE status NOT IN ('ativo', 'cancelado', 'trial', 'expirada', 'pendente')
      GROUP BY status
    ` as { status: string; total: number }[];
    if (statusInvalidos.length > 0) {
      const lista = statusInvalidos.map(r => `${r.status}(${r.total})`).join(", ");
      falhas.push(`Assinaturas com status inválido detectadas: ${lista}`);
    }

    // 3. Trial vencido sem atualização de tipo_usuario
    const [trialsVencidos] = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios
      WHERE tipo_usuario = 'trial' AND trial_fim < NOW()
    `;
    if (Number(trialsVencidos.total) > 0) {
      falhas.push(`${trialsVencidos.total} usuário(s) com trial expirado mas tipo_usuario ainda = 'trial'`);
    }

    // 4. Fila WhatsApp represada (>50 mensagens pendentes há mais de 2h)
    const [filaPresa] = await sql`
      SELECT COUNT(*)::int AS total FROM whatsapp_fila
      WHERE status = 'pendente' AND criado_em < NOW() - INTERVAL '2 hours'
    `;
    if (Number(filaPresa.total) > 50) {
      falhas.push(`Fila WhatsApp represada: ${filaPresa.total} mensagens pendentes há >2h`);
    }

    // 5. Usuários free com mais de 5 favoritos (vazamento do limite premium)
    const [favoritosVazamento] = await sql`
      SELECT COUNT(*)::int AS total
      FROM (
        SELECT f.usuario_id
        FROM favoritos f
        JOIN usuarios u ON u.id = f.usuario_id
        WHERE u.tipo_usuario = 'free'
        GROUP BY f.usuario_id
        HAVING COUNT(*) > 5
      ) t
    `;
    if (Number(favoritosVazamento.total) > 0) {
      falhas.push(`${favoritosVazamento.total} usuário(s) free com >5 favoritos (limite premium vazou)`);
    }

    // 6. Backlog crítico de falhas por agente (>10 falhas abertas de um mesmo agente em 24h)
    const falhasAcumuladas = await sql`
      SELECT agente, COUNT(*)::int AS total FROM falhas_agentes
      WHERE resolvido = false AND criado_em > NOW() - INTERVAL '24 hours'
      GROUP BY agente HAVING COUNT(*) > 10
    ` as { agente: string; total: number }[];
    if (falhasAcumuladas.length > 0) {
      const lista = falhasAcumuladas.map(r => `${r.agente}(${r.total}x)`).join(", ");
      falhas.push(`Backlog crítico detectado: ${lista}`);
    }

    // 7. Usuários premium/trial sem plano semanal gerado na semana atual
    const semanaAtual = new Date();
    const diff = semanaAtual.getDay() === 0 ? -6 : 1 - semanaAtual.getDay();
    semanaAtual.setDate(semanaAtual.getDate() + diff);
    const semanaStr = semanaAtual.toISOString().slice(0, 10);
    const [semPlano] = await sql`
      SELECT COUNT(*)::int AS total FROM usuarios u
      WHERE u.tipo_usuario IN ('premium', 'trial')
        AND NOT EXISTS (
          SELECT 1 FROM planos_semanais ps
          WHERE ps.usuario_id = u.id AND ps.semana = ${semanaStr}
        )
    `;
    if (Number(semPlano.total) > 20) {
      falhas.push(`${semPlano.total} usuários premium/trial sem plano semanal para esta semana`);
    }

    if (falhas.length > 0) {
      for (const f of falhas) {
        await reportarFalha("fiscal-codigo-logica", f, {
          tipo: "codigo_logica",
          severidade: "alto",
        });
      }

      fetch(`${APP}/api/cron/revisor-logica`, {
        headers: { Authorization: `Bearer ${CRON}` },
        signal: AbortSignal.timeout(5000),
      }).catch(() => {});

      await alertarTelegram(
        "⚙️",
        "FISCAL LÓGICA — ANOMALIAS DETECTADAS",
        falhas.map(f => `❌ ${f}`).join("\n") + "\n\n🔧 Revisor de lógica acionado."
      );
    } else {
      await resolverFalhas("fiscal-codigo-logica");
    }

    return NextResponse.json({ ok: falhas.length === 0, falhas });
  } catch (err) {
    await reportarFalha("fiscal-codigo-logica", String(err), {
      tipo: "codigo_logica",
      severidade: "critico",
    });
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
