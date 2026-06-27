/**
 * INAÊ INADIMPLÊNCIA — Monitora inadimplência acumulada e pagamentos parados
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { criarAlertaDedup } from "@/lib/alertas";

const VALOR_PLANO: Record<string, number> = {
  vip: 9.9,
  elite: 19.9,
};

function formatBRL(v: number): string {
  return v.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();

  try {
    // 1. Usuários inadimplentes — junta com a última assinatura de cada um para usar o
    // valor REAL cobrado (normalizando anual/12) em vez de um preço fixo por plano, que
    // fica desatualizado sempre que o preço muda (mesma fonte de verdade do lib/mrr.ts).
    const inadimplentes = await sql`
      SELECT u.id, u.nome, u.email, u.plano, u.status, u.updated_at, u.created_at,
             a.valor as assinatura_valor, a.ciclo as assinatura_ciclo
      FROM usuarios u
      LEFT JOIN LATERAL (
        SELECT valor, ciclo FROM assinaturas
        WHERE usuario_id = u.id
        ORDER BY created_at DESC
        LIMIT 1
      ) a ON true
      WHERE u.status = 'inadimplente'
      ORDER BY u.updated_at ASC
    `;

    // 2. Calcula total de inadimplência e agrupamento por plano
    let totalInadimplencia = 0;
    const porPlano: Record<string, { qtd: number; valor: number }> = {};
    const graves: Array<{ nome: string; plano: string; dias: number }> = [];

    for (const u of inadimplentes) {
      const plano = String(u.plano ?? "vip");
      const valorAssinatura = u.assinatura_valor != null ? Number(u.assinatura_valor) : null;
      const valor = valorAssinatura != null
        ? (u.assinatura_ciclo === "anual" ? valorAssinatura / 12 : valorAssinatura)
        : (VALOR_PLANO[plano] ?? 9.9);
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

      const { criado } = await criarAlertaDedup(
        "inadimplencia_alta",
        "alto",
        `Inadimplência acumulada: R$ ${formatBRL(totalInadimplencia)} (${inadimplentes.length} usuários)`
      );

      if (criado) {
        await alertarTelegram(
          "🔴",
          "INAÊ INADIMPLÊNCIA — Total acima de R$150",
          `💸 Total inadimplente: R$ ${formatBRL(totalInadimplencia)}\n${inadimplentes.length} usuário(s)\n\n${linhas}${gravesMsg}`
        );
      }
    } else if (totalInadimplencia > 50) {
      // FASE 23: este aviso e o de Pix parado abaixo disparavam Telegram a cada execução
      // do cron enquanto a condição persistisse (mesmo padrão de spam que o Fase 17 já
      // corrigiu para inadimplencia_alta/mrr_queda) — faltava aplicar o mesmo dedup aqui.
      const { criado } = await criarAlertaDedup(
        "inadimplencia_media",
        "medio",
        `Inadimplência acumulada: R$ ${formatBRL(totalInadimplencia)} (${inadimplentes.length} usuários)`
      );
      if (criado) {
        await alertarTelegram(
          "🟡",
          "INAÊ INADIMPLÊNCIA — Aviso",
          `💸 Total inadimplente: R$ ${formatBRL(totalInadimplencia)} (${inadimplentes.length} usuário(s))`
        );
      }
    }

    if (qtdPixParados > 0) {
      const { criado: criadoPix } = await criarAlertaDedup(
        "pix_parado",
        "medio",
        `${qtdPixParados} Pix pendente(s) sem confirmação há +2h — total R$ ${formatBRL(totalPixParado)}`
      );
      if (criadoPix) {
        await alertarTelegram(
          "🟡",
          "INAÊ INADIMPLÊNCIA — Pix parado há +2h",
          `${qtdPixParados} Pix pendente(s) sem confirmação — total R$ ${formatBRL(totalPixParado)}\n\nVerificar painel do Mercado Pago.`
        );
      }
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
