import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium } from "@/lib/auth";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const session = await getSession();

    const rows = await sql`SELECT * FROM receitas WHERE id = ${parseInt(id)} LIMIT 1`;

    if (rows.length === 0) {
      return NextResponse.json({ erro: "Receita não encontrada" }, { status: 404 });
    }

    const receita = rows[0];

    let userIsPremium = false;
    if (session) {
      const uRows = await sql`SELECT tipo_usuario, trial_fim FROM usuarios WHERE id = ${session.id} LIMIT 1`;
      if (uRows.length > 0) {
        userIsPremium = isPremium(uRows[0].tipo_usuario, uRows[0].trial_fim);
      }
    }

    // Free users: check if recipe is among the top 10 of its category (those are unlocked)
    let isCategoryFreeUnlocked = false;
    if (!userIsPremium && receita.is_premium && !receita.is_free_rotativa) {
      const top10 = await sql`
        SELECT id FROM receitas
        WHERE is_personal=false AND categoria=${receita.categoria}
        ORDER BY created_at DESC LIMIT 10
      `;
      const freeIds = new Set(top10.map((r) => r.id));
      if (freeIds.has(receita.id)) {
        isCategoryFreeUnlocked = true;
      }
    }

    // Recipe is locked — return only teaser data
    if (receita.is_premium && !receita.is_free_rotativa && !userIsPremium && !isCategoryFreeUnlocked) {
      return NextResponse.json({
        dados: {
          id: receita.id,
          titulo: receita.titulo,
          descricao: receita.descricao,
          categoria: receita.categoria,
          tags_restricao: receita.tags_restricao,
          tempo_preparo: receita.tempo_preparo,
          calorias: receita.calorias,
          porcoes: receita.porcoes,
          foto_url: receita.foto_url,
          is_premium: receita.is_premium,
          is_free_rotativa: receita.is_free_rotativa,
          avaliacao_media: receita.avaliacao_media,
          avaliacao_count: receita.avaliacao_count,
          locked: true,
        },
      });
    }

    // Normalize fields that may differ between DB schemas
    function normalizeIngredientes(raw: unknown): string {
      if (typeof raw === "string") return raw;
      if (Array.isArray(raw)) {
        return raw.map((item: unknown) => {
          if (typeof item === "string") return `• ${item}`;
          if (item && typeof item === "object") {
            const o = item as Record<string, unknown>;
            const qtd = o.quantidade || o.qtd || "";
            const nome = o.item || o.nome || o.ingrediente || "";
            return qtd ? `• ${qtd} ${nome}` : `• ${nome}`;
          }
          return String(item);
        }).join("\n");
      }
      return "";
    }

    function normalizeModo(raw: unknown): string {
      if (typeof raw === "string") return raw;
      if (Array.isArray(raw)) {
        return raw.map((step: unknown, i: number) => `${i + 1}. ${step}`).join("\n");
      }
      return "";
    }

    // Free user with unlocked recipe — gate macros and dica_vovo
    const dados: Record<string, unknown> = {
      ...receita,
      locked: false,
      // Normalize column name aliases
      descricao: receita.descricao ?? receita.descricao_curta ?? null,
      ingredientes: normalizeIngredientes(receita.ingredientes),
      modo_preparo: normalizeModo(receita.modo_preparo),
      proteina: receita.proteina ?? receita.proteinas ?? null,
      gordura: receita.gordura ?? receita.gorduras ?? null,
    };

    if (!userIsPremium) {
      dados.proteina = null;
      dados.carboidratos = null;
      dados.gordura = null;
      dados.fibras = null;
      if (typeof dados.dica_vovo === "string" && dados.dica_vovo.length > 120) {
        dados.dica_vovo = dados.dica_vovo.substring(0, 120) + "...";
        dados.dica_vovo_truncada = true;
      }
    }

    return NextResponse.json({ dados });
  } catch (err) {
    console.error("receita GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
