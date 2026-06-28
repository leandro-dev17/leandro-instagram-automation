import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";

// ── SCHEMA FIXES ────────────────────────────────────────────────────────────
async function fixSchema() {
  // Adiciona coluna mensagem na whatsapp_fila se não existir
  await sql`ALTER TABLE whatsapp_fila ADD COLUMN IF NOT EXISTS mensagem TEXT`.catch(() => {});
  // FASE 30: faltava `resolvido = true` — apagava alertas críticos ainda não resolvidos
  // (dos quais escalar-claude/gerente-codigo/relatorio-ceo dependem) só por terem >24h,
  // mesmo nunca tratados. Mesmo filtro já usado em agente-limpeza.
  const deleted = await sql`DELETE FROM alertas WHERE resolvido = true AND created_at < NOW() - INTERVAL '24 hours' RETURNING id`;
  return deleted.length;
}

// Corrige mojibake: Ã³ → ó, Ã£ → ã, etc.
// Detecta pares (0xC2|0xC3) + continuation byte (0x80-0xBF) e reconstrói o codepoint UTF-8
function fixMojibake(s: string | null): string | null {
  if (!s) return s;
  let result = "";
  let i = 0;
  while (i < s.length) {
    const code = s.charCodeAt(i);
    if ((code === 0xC2 || code === 0xC3) && i + 1 < s.length) {
      const next = s.charCodeAt(i + 1);
      if (next >= 0x80 && next <= 0xBF) {
        result += String.fromCodePoint(((code & 0x1F) << 6) | (next & 0x3F));
        i += 2;
        continue;
      }
    }
    result += s[i];
    i++;
  }
  return result;
}

function temMojibake(s: string | null): boolean {
  if (!s) return false;
  for (let i = 0; i < s.length - 1; i++) {
    const code = s.charCodeAt(i);
    if ((code === 0xC2 || code === 0xC3) && s.charCodeAt(i + 1) >= 0x80 && s.charCodeAt(i + 1) <= 0xBF) return true;
  }
  return false;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const alertasLimpos = await fixSchema();

  // Diagnóstico: pega uma amostra e testa diretamente
  const amostraDiag = (await sql`SELECT id, titulo FROM noticias WHERE titulo LIKE '%Ã%' LIMIT 3`) as unknown as { id: number; titulo: string }[];
  const diagnostico = amostraDiag.map((r) => {
    const codes = Array.from(r.titulo).slice(0, 10).map(c => c.charCodeAt(0).toString(16));
    const mojibake = temMojibake(r.titulo);
    const fixed = fixMojibake(r.titulo);
    return { id: r.id, titulo: r.titulo.substring(0, 40), codes, mojibake, fixed: fixed?.substring(0, 40) };
  });

  const rows = (await sql`SELECT id, titulo, resumo_braga, resumo_cavalcanti FROM noticias WHERE titulo LIKE '%Ã%' OR titulo LIKE '%Â%' OR resumo_braga LIKE '%Ã%'`) as unknown as { id: number; titulo: string; resumo_braga: string | null; resumo_cavalcanti: string | null }[];

  let fixedTitulos = 0, fixedBraga = 0, fixedCavalcanti = 0;

  for (const row of rows) {
    if (temMojibake(row.titulo)) {
      const fixed = fixMojibake(row.titulo)!;
      await sql`UPDATE noticias SET titulo = ${fixed} WHERE id = ${row.id}`;
      fixedTitulos++;
    }
    if (row.resumo_braga && temMojibake(row.resumo_braga)) {
      const fixed = fixMojibake(row.resumo_braga)!;
      await sql`UPDATE noticias SET resumo_braga = ${fixed} WHERE id = ${row.id}`;
      fixedBraga++;
    }
    if (row.resumo_cavalcanti && temMojibake(row.resumo_cavalcanti)) {
      const fixed = fixMojibake(row.resumo_cavalcanti)!;
      await sql`UPDATE noticias SET resumo_cavalcanti = ${fixed} WHERE id = ${row.id}`;
      fixedCavalcanti++;
    }
  }

  const amostra = (await sql`SELECT titulo FROM noticias ORDER BY created_at DESC LIMIT 5`) as unknown as { titulo: string }[];

  return NextResponse.json({
    ok: true,
    total_analisados: rows.length,
    titulos_corrigidos: fixedTitulos,
    resumos_braga_corrigidos: fixedBraga,
    resumos_cavalcanti_corrigidos: fixedCavalcanti,
    diagnostico,
    alertas_limpos: alertasLimpos,
    amostra: amostra.map((n) => n.titulo),
  });
}
