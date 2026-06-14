import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    const r1 = await sql`UPDATE noticias SET titulo = convert_from(convert_to(titulo, 'LATIN1'), 'UTF8') WHERE titulo ~ '[ÃÂ]' RETURNING id`;
    const r2 = await sql`UPDATE noticias SET resumo_braga = convert_from(convert_to(resumo_braga, 'LATIN1'), 'UTF8') WHERE resumo_braga IS NOT NULL AND resumo_braga ~ '[ÃÂ]' RETURNING id`;
    const r3 = await sql`UPDATE noticias SET resumo_cavalcanti = convert_from(convert_to(resumo_cavalcanti, 'LATIN1'), 'UTF8') WHERE resumo_cavalcanti IS NOT NULL AND resumo_cavalcanti ~ '[ÃÂ]' RETURNING id`;

    const amostra = await sql`SELECT titulo FROM noticias ORDER BY created_at DESC LIMIT 5`;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('fix-encoding', 'corrigir_encoding', 'sucesso',
        ${JSON.stringify({ titulos: r1.length, resumos_braga: r2.length, resumos_cavalcanti: r3.length })})
    `.catch(() => {});

    return NextResponse.json({
      ok: true,
      titulos_corrigidos: r1.length,
      resumos_braga_corrigidos: r2.length,
      resumos_cavalcanti_corrigidos: r3.length,
      amostra: amostra.map(n => n.titulo),
    });
  } catch (err) {
    await alertarTelegram("🔴", "Falha fix-encoding", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
