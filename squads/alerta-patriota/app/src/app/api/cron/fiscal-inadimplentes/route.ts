/**
 * INAÊ INADIMPLÊNCIA — Monitora inadimplência acumulada e pagamentos parados
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

const VALOR_PLANO: Record<string, number> = {
  basico: 12.9,
  patriota: 29.9,
  vip: 59.9,
  elite: 41.58,
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // 1. Usuários inadimplentes
    const inadimplentes = await sql`
      SELECT id, nome, email, plano, status, updated_at, created_at
      FROM usuarios
      WHERE status = 'inadimplente'
      ORDER BY updated_at ASC
    `;

    // 2. Calcula total de inadimplência e agrupamento por plano
    let totalInadimplencia = 0;
    const porPlano: Record<string, { qtd: number; valor: number }> = {};
    const graves: Array<{ nome: string; plano: string; dias: number }> = [];

    for (const u of inadimplentes) {
      const plano = String(u.plano ?? "basico");
      const valor = VALOR_PLANO[plano] ?? 12.9;
      totalInadimplencia += valor;

      if (!porPlano[plano]) porPlano[plano] = { qtd: 0, valor: 0 };
      porPlano[plano].qtd += 1;
      porPlano[plano].valor += valor;

      const diasInadimplente = Math.floor(
        (Date.now() - new Date(String(u.updated_at)).getTime()) / (1000 * 60 * 60 * 24)
      );
      if (diasInadimplente >= 7) {
        graves.push({ nome: String(u.nome), plano, dias: diasInadimplente });
      }
    }

    // 3. Pagamentos pendentes há mais de 2h (Pix não confirmado)
    const pixPendentes = await sql`
      SELECT p.id, p.valor, p.created_at, u.nome, u.email
      FROM pagamentos p
      JOIN usuarios u ON u.id = p.usuario_id
      WHERE p.status = 'pendente'
        AND p.metodo = 'pix'
        AND p.created_at <= NOW() - INTERVAL '2 hours'
      ORDER BY p.created_at ASC
    `;

    const qtdPixParados = pixPendentes.length;
    const totalPixParado = pixPendentes.reduce((acc, p) => acc + Number(p.valor), 0);

    // 4. Disparo de alertas por faixa
    if (totalInadimplencia > 150) {
      const linhas = Object.entries(porPlano)
        .map(([p, v]) => `• ${p}: ${v.qtd} inadimplente(s) — R$ ${formatBRL(v.valor)}`)
        .join("\n");

      const gravesMsg =
        graves.length > 0
          ? `\n\nCasos graves (+7 dias):\n${graves.map((g) => `• ${g.nome} (${g.plano}) — ${g.dias} dias`).join("\n")}`
          : "";

      await alertarTelegram(
        "🔴",
        "INAÊ INADIMPLÊNCIA — Total acima de R$150",
        `💸 Total inadimplente: R$ ${formatBRL(totalInadimplencia)}\n${inadimplentes.length} usuário(s)\n\n${linhas}${gravesMsg}`
      );

      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES (
          'inadimplencia_alta',
          'alto',
          ${`Inadimplência acumulada: R$ ${formatBRL(totalInadimplencia)} (${inadimplentes.length} usuários)`}
        )
      `;
    } else if (totalInadimplencia > 50) {
      await alertarTelegram(
        "🟡",
        "INAÊ INADIMPLÊNCIA — Aviso",
        `💸 Total inadimplente: R$ ${formatBRL(totalInadimplencia)} (${inadimplentes.length} usuário(s))`
      );
    }

    if (qtdPixParados > 0) {
      await alertarTelegram(
        "🟡",
        "INAÊ INADIMPLÊNCIA — Pix parado há +2h",
        `${qtdPixParados} Pix pendente(s) sem confirmação — total R$ ${formatBRL(totalPixParado)}\n\nVerificar painel do Mercado Pago.`
      );
    }

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'inae-inadimplencia',
        'verificar_inadimplencia',
        ${totalInadimplencia > 150 ? "aviso" : "sucesso"},
        ${JSON.stringify({
          total_inadimplencia: totalInadimplencia,
          qtd_inadimplentes: inadimplentes.length,
          por_plano: porPlano,
          casos_graves: graves.length,
          pix_parados: qtdPixParados,
          total_pix_parado: totalPixParado,
        })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: totalInadimplencia <= 50 && qtdPixParados === 0,
      total_inadimplencia: totalInadimplencia,
      qtd_inadimplentes: inadimplentes.length,
      por_plano: porPlano,
      casos_graves: graves,
      pix_parados: qtdPixParados,
      total_pix_parado: totalPixParado,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "INAÊ INADIMPLÊNCIA — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
