import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const data = new Date().toLocaleDateString("pt-BR");
  const relatorio: Record<string, unknown> = {};

  // === NEGÓCIO ===
  let mrr = 0;
  let totalAtivos = 0;
  let novosHoje = 0;
  let canceladosHoje = 0;

  try {
    const [assinaturas] = await sql`
      SELECT
        COUNT(*) FILTER (WHERE status = 'ativo') as ativos,
        SUM(CASE WHEN status = 'ativo' AND plano = 'anual' THEN valor / 12
                 WHEN status = 'ativo' AND plano = 'trimestral' THEN valor / 3
                 ELSE 0 END) as mrr,
        COUNT(*) FILTER (WHERE status = 'ativo' AND renovada_em > NOW() - INTERVAL '24 hours') as novos_hoje,
        COUNT(*) FILTER (WHERE status IN ('cancelado', 'paused') AND renovada_em > NOW() - INTERVAL '24 hours') as cancelados_hoje
      FROM assinaturas
    `;
    totalAtivos = Number(assinaturas.ativos ?? 0);
    mrr = Number(assinaturas.mrr ?? 0);
    novosHoje = Number(assinaturas.novos_hoje ?? 0);
    canceladosHoje = Number(assinaturas.cancelados_hoje ?? 0);
    relatorio.negocio = { mrr, totalAtivos, novosHoje, canceladosHoje };
  } catch {
    // banco indisponível — continua
  }

  // === USUÁRIOS ===
  let totalUsuarios = 0;
  let novosUsuariosHoje = 0;
  try {
    const [usuarios] = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE criada_em > NOW() - INTERVAL '24 hours') as novos_hoje
      FROM usuarios
    `;
    totalUsuarios = Number(usuarios.total ?? 0);
    novosUsuariosHoje = Number(usuarios.novos_hoje ?? 0);
    relatorio.usuarios = { totalUsuarios, novosUsuariosHoje };
  } catch { /* silencioso */ }

  // === CONTEÚDO ===
  let totalReceitas = 0;
  let receitasFree = 0;
  try {
    const [conteudo] = await sql`
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE is_free_rotativa = TRUE) as free_rotativa
      FROM receitas
    `;
    totalReceitas = Number(conteudo.total ?? 0);
    receitasFree = Number(conteudo.free_rotativa ?? 0);
    relatorio.conteudo = { totalReceitas, receitasFree };
  } catch { /* silencioso */ }

  // === OPERAÇÕES (falhas 24h) ===
  let falhas24h = 0;
  let agentesMaisProblematicos = "";
  try {
    const falhas = await sql`
      SELECT agente, COUNT(*) as total
      FROM falhas_agentes
      WHERE criado_em > NOW() - INTERVAL '24 hours'
      GROUP BY agente
      ORDER BY total DESC
      LIMIT 3
    `;
    falhas24h = falhas.reduce((acc, f) => acc + Number(f.total), 0);
    if (falhas.length > 0) {
      agentesMaisProblematicos = falhas.map(f => `${f.agente}(${f.total}x)`).join(", ");
    }
    relatorio.operacoes = { falhas24h, agentesMaisProblematicos };
  } catch { /* silencioso */ }

  // === MONTA MENSAGEM ===
  const saldoDia = novosHoje - canceladosHoje;
  const saldoIcone = saldoDia > 0 ? "📈" : saldoDia < 0 ? "📉" : "➡️";
  const saudeIcone = falhas24h === 0 ? "🟢" : falhas24h < 5 ? "🟡" : "🔴";

  const msg =
    `👑 <b>Relatório CEO — ${data}</b>\n\n` +

    `💰 <b>Financeiro</b>\n` +
    `• MRR: R$ ${mrr.toFixed(2)}\n` +
    `• Assinantes ativos: ${totalAtivos}\n` +
    `• ${saldoIcone} Hoje: +${novosHoje} novos, -${canceladosHoje} cancelados\n\n` +

    `👥 <b>Usuários</b>\n` +
    `• Total: ${totalUsuarios}\n` +
    `• Novos hoje: ${novosUsuariosHoje}\n\n` +

    `🍲 <b>Conteúdo</b>\n` +
    `• Receitas cadastradas: ${totalReceitas}\n` +
    `• Free rotativa ativas: ${receitasFree}\n\n` +

    `${saudeIcone} <b>Operações</b>\n` +
    (falhas24h === 0
      ? `• Todos os agentes funcionando normalmente\n`
      : `• ${falhas24h} falha(s) nas últimas 24h\n` +
        (agentesMaisProblematicos ? `• Agentes: ${agentesMaisProblematicos}\n` : "")) +

    `\n<i>Próximo relatório: amanhã às 8h</i>`;

  await enviarTelegram(msg);

  return NextResponse.json({ ok: true, relatorio });
}
