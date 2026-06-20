/**
 * FISCAL DIANA DUPLICATA — Detecta mensagens duplicadas enviadas ao mesmo grupo
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const duplicatas: Array<Record<string, unknown>> = [];

  try {
    // 1. Mesmo grupo + mesmo tipo com menos de 20 minutos de diferença nas últimas 2h
    const duplicatasTipo = await sql`
      SELECT
        a.grupo_id,
        a.tipo,
        a.enviado_at AS primeira,
        b.enviado_at AS segunda,
        g.nome AS grupo_nome,
        EXTRACT(EPOCH FROM (b.enviado_at - a.enviado_at)) / 60 AS diff_minutos
      FROM posts_whatsapp a
      JOIN posts_whatsapp b
        ON a.grupo_id = b.grupo_id
        AND a.tipo = b.tipo
        AND b.id > a.id
        AND b.enviado_at - a.enviado_at < INTERVAL '20 minutes'
        AND b.enviado_at > NOW() - INTERVAL '2 hours'
        AND a.enviado_at > NOW() - INTERVAL '2 hours'
      JOIN grupos_whatsapp g ON g.id = a.grupo_id
      ORDER BY a.enviado_at DESC
      LIMIT 500
    `;

    for (const dup of duplicatasTipo) {
      duplicatas.push({
        tipo: "mesmo_tipo",
        grupo_id: dup.grupo_id,
        grupo_nome: dup.grupo_nome,
        tipo_mensagem: dup.tipo,
        primeira: dup.primeira,
        segunda: dup.segunda,
        diff_minutos: Math.round(Number(dup.diff_minutos)),
      });
    }

    // 2. Mesmo conteúdo (primeiros 100 chars) enviado 2x para o mesmo grupo
    const duplicatasConteudo = await sql`
      SELECT
        a.grupo_id,
        LEFT(a.conteudo, 100) AS prefixo,
        COUNT(*) AS total,
        g.nome AS grupo_nome,
        MIN(a.enviado_at) AS primeira,
        MAX(a.enviado_at) AS ultima
      FROM posts_whatsapp a
      JOIN grupos_whatsapp g ON g.id = a.grupo_id
      WHERE a.enviado_at > NOW() - INTERVAL '2 hours'
        AND a.status = 'enviado'
      GROUP BY a.grupo_id, LEFT(a.conteudo, 100), g.nome
      HAVING COUNT(*) >= 2
      ORDER BY total DESC
    `;

    for (const dup of duplicatasConteudo) {
      duplicatas.push({
        tipo: "mesmo_conteudo",
        grupo_id: dup.grupo_id,
        grupo_nome: dup.grupo_nome,
        prefixo_conteudo: dup.prefixo,
        total_envios: dup.total,
        primeira: dup.primeira,
        ultima: dup.ultima,
      });
    }

    if (duplicatas.length > 0) {
      const grupos = [...new Set(duplicatas.map((d) => d.grupo_nome))].join(", ");
      const tipos = [...new Set(duplicatas.map((d) => d.tipo_mensagem || d.tipo))].join(", ");

      await sql`
        INSERT INTO alertas (tipo, severidade, mensagem)
        VALUES (
          'duplicata_detectada',
          'medio',
          ${`${duplicatas.length} duplicata(s) detectada(s) nos grupos: ${grupos}`}
        )
      `;

      await alertarTelegram(
        "🟡",
        "FISCAL DIANA DUPLICATA — Duplicatas Detectadas",
        `${duplicatas.length} duplicata(s) encontrada(s)\nGrupos: ${grupos}\nTipos: ${tipos}\n\nVerifique: alertapatriota.vercel.app/admin`
      );
    }

    const duracao = Date.now() - inicio;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'diana-duplicata',
        'verificar_duplicatas',
        ${duplicatas.length > 0 ? "aviso" : "sucesso"},
        ${JSON.stringify({ total_duplicatas: duplicatas.length })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: duplicatas.length === 0,
      total_duplicatas: duplicatas.length,
      duplicatas,
      duracao_ms: duracao,
    });
  } catch (err) {
    await alertarTelegram("🚨", "FISCAL DIANA DUPLICATA — ERRO INTERNO", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
