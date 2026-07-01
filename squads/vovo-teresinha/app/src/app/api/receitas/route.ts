import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium, isBasico } from "@/lib/auth";

const VALID_TAGS = new Set(["sem_gluten", "sem_lactose", "low_carb", "sem_acucar", "vegano", "vegetariano", "proteica"]);
const VALID_CATS = new Set(["cafe_manha", "pratos_principais", "lanches_snacks", "doces_sobremesas", "saladas", "sopas_caldos", "sucos_molhos", "bolos_tortas"]);

export async function GET(req: NextRequest) {
  try {
    const session = await getSession();
    const { searchParams } = new URL(req.url);
    const categoriaRaw = searchParams.get("categoria") || "";
    const busca = searchParams.get("busca") || "";
    const tagsParam = searchParams.get("tags") || "";
    const pagina = parseInt(searchParams.get("pagina") || "1");
    const limite = parseInt(searchParams.get("limite") || "20");
    const offset = (pagina - 1) * limite;

    const categoria = VALID_CATS.has(categoriaRaw) ? categoriaRaw : "";
    const validTags = tagsParam.split(",").filter(t => VALID_TAGS.has(t));
    const t0 = validTags[0] ? "%" + validTags[0] + "%" : "";
    const t1 = validTags[1] ? "%" + validTags[1] + "%" : "";
    const hasTags = validTags.length > 0;
    const b = busca ? "%" + busca + "%" : "";

    if (!session) {
      return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });
    }

    let userIsPremium = false;
    let userIsBasico = false;
    let userTrial: string | null = null;

    const uRows = await sql`SELECT tipo_usuario, trial_fim, plano FROM usuarios WHERE id = ${session.id} LIMIT 1`;
    if (uRows.length > 0) {
      userIsPremium = isPremium(uRows[0].tipo_usuario, uRows[0].trial_fim, uRows[0].plano);
      userIsBasico = isBasico(uRows[0].tipo_usuario, uRows[0].plano);
      userTrial = uRows[0].trial_fim;
    }

    // Sem assinatura ativa (Caderninho ou Livro de Receitas): sem acesso ao catálogo
    if (!userIsPremium && !userIsBasico) {
      return NextResponse.json(
        { erro: "Assine um plano para ver as receitas", premium: false, basico: false },
        { status: 403 }
      );
    }

    let rows;

    if (userIsBasico) {
      // ── CADERNINHO (BÁSICO) ───────────────────────────────────
      // Acesso completo às 80 receitas do pool (is_free_rotativa=true), em qualquer categoria
      if (categoria) {
        if (busca && hasTags && t1) {
          rows = await sql`
            SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                   porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
            FROM receitas WHERE is_personal=false AND is_free_rotativa=true AND categoria=${categoria}
              AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
              AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
            ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
        } else if (busca && hasTags) {
          rows = await sql`
            SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                   porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
            FROM receitas WHERE is_personal=false AND is_free_rotativa=true AND categoria=${categoria}
              AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
              AND tags_restricao::text ILIKE ${t0}
            ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
        } else if (busca) {
          rows = await sql`
            SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                   porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
            FROM receitas WHERE is_personal=false AND is_free_rotativa=true AND categoria=${categoria}
              AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
            ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
        } else if (hasTags && t1) {
          rows = await sql`
            SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                   porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
            FROM receitas WHERE is_personal=false AND is_free_rotativa=true AND categoria=${categoria}
              AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
            ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
        } else if (hasTags) {
          rows = await sql`
            SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                   porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
            FROM receitas WHERE is_personal=false AND is_free_rotativa=true AND categoria=${categoria}
              AND tags_restricao::text ILIKE ${t0}
            ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
        } else {
          rows = await sql`
            SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                   porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
            FROM receitas WHERE is_personal=false AND is_free_rotativa=true AND categoria=${categoria}
            ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
        }
      } else if (busca && hasTags && t1) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_free_rotativa=true
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
            AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (busca && hasTags) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_free_rotativa=true
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
            AND tags_restricao::text ILIKE ${t0}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (busca) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_free_rotativa=true
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (hasTags && t1) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_free_rotativa=true
            AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (hasTags) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_free_rotativa=true
            AND tags_restricao::text ILIKE ${t0}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_free_rotativa=true
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      }
    } else {
      // ── PREMIUM / ALUNA ───────────────────────────────────────
      if (busca && categoria && hasTags && t1) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false AND categoria=${categoria}
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
            AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (busca && categoria && hasTags) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false AND categoria=${categoria}
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
            AND tags_restricao::text ILIKE ${t0}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (busca && categoria) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false AND categoria=${categoria}
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (busca && hasTags && t1) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
            AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (busca && hasTags) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
            AND tags_restricao::text ILIKE ${t0}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (busca) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false
            AND (titulo ILIKE ${b} OR descricao ILIKE ${b})
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (categoria && hasTags && t1) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false AND categoria=${categoria}
            AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (categoria && hasTags) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false AND categoria=${categoria}
            AND tags_restricao::text ILIKE ${t0}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (categoria) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false AND categoria=${categoria}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (hasTags && t1) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false
            AND tags_restricao::text ILIKE ${t0} AND tags_restricao::text ILIKE ${t1}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else if (hasTags) {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false
            AND tags_restricao::text ILIKE ${t0}
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      } else {
        rows = await sql`
          SELECT id, titulo, descricao, categoria, tags_restricao, tempo_preparo, calorias,
                 porcoes, foto_url, is_premium, is_free_rotativa, is_personal, created_at
          FROM receitas WHERE is_personal=false
          ORDER BY created_at DESC LIMIT ${limite} OFFSET ${offset}`;
      }
    }

    return NextResponse.json({
      dados: rows,
      premium: userIsPremium,
      basico: userIsBasico,
      trial_fim: userTrial,
    });
  } catch (err) {
    console.error("receitas GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
