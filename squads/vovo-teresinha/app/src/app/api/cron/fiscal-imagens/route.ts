/**
 * FISCAL IGOR IMAGENS — Fiscal de Imagens de Receitas
 * Verifica se as imagens das receitas estão acessíveis (não retornam 404/erro).
 * Detecta receitas sem foto e imagens quebradas.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { cronAutorizado } from "@/lib/auth-cron";
import { enviarTelegram } from "@/lib/telegram";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    // Receitas sem foto_url
    const semFoto = await sql`
      SELECT id, titulo FROM receitas
      WHERE foto_url IS NULL OR foto_url = ''
      LIMIT 20
    ` as { id: number; titulo: string }[];

    // Receitas com foto_url — verifica uma amostra (máx 20)
    const comFoto = await sql`
      SELECT id, titulo, foto_url FROM receitas
      WHERE foto_url IS NOT NULL AND foto_url != ''
      ORDER BY created_at DESC
      LIMIT 20
    ` as { id: number; titulo: string; foto_url: string }[];

    const imagensQuebradas: string[] = [];

    for (const receita of comFoto) {
      try {
        const res = await fetch(receita.foto_url, {
          method: "HEAD",
          signal: AbortSignal.timeout(5000),
        });
        if (!res.ok) {
          imagensQuebradas.push(`"${receita.titulo}" (${res.status}): ${receita.foto_url.slice(0, 60)}...`);
        }
      } catch {
        imagensQuebradas.push(`"${receita.titulo}" (timeout): ${receita.foto_url.slice(0, 60)}...`);
      }
    }

    const temProblemas = semFoto.length > 0 || imagensQuebradas.length > 0;

    if (temProblemas) {
      const linhas = [`📸 <b>Fiscal Imagens — Problemas Detectados</b>`];

      if (semFoto.length > 0) {
        linhas.push(`\n🚫 Receitas sem foto (${semFoto.length}):`);
        semFoto.slice(0, 5).forEach(r => linhas.push(`  • ${r.titulo} (id: ${r.id})`));
        if (semFoto.length > 5) linhas.push(`  ... e mais ${semFoto.length - 5}`);
      }

      if (imagensQuebradas.length > 0) {
        linhas.push(`\n🔴 Imagens inacessíveis (${imagensQuebradas.length}):`);
        imagensQuebradas.slice(0, 5).forEach(img => linhas.push(`  • ${img}`));
      }

      linhas.push(`\n<i>Verifique e atualize as imagens no painel admin.</i>`);

      await enviarTelegram(linhas.join("\n"));

      for (const msg of [...semFoto.map(r => `Receita sem foto: ${r.titulo}`), ...imagensQuebradas]) {
        await reportarFalha("fiscal-imagens", msg.slice(0, 200), { severidade: "medio" });
      }
    } else {
      await resolverFalhas("fiscal-imagens");
    }

    return NextResponse.json({
      ok: !temProblemas,
      sem_foto: semFoto.length,
      imagens_quebradas: imagensQuebradas.length,
      verificadas: comFoto.length,
    });
  } catch (err) {
    await reportarFalha("fiscal-imagens", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
