import { NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { getSession, isPremium } from "@/lib/auth";

const DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"] as const;
const REFEICOES = ["cafe", "almoco", "lanche", "jantar"] as const;

function getMondayOfWeek(date: Date): string {
  const d = new Date(date);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

async function gerarPlanoAutomatico(usuarioId: number, semana: string) {
  // Busca receitas do favoritos do usuário primeiro
  const favoritos = await sql`
    SELECT r.id, r.titulo, r.foto_url, r.tempo_preparo, r.refeicao, r.categoria
    FROM receitas r
    JOIN favoritos f ON f.receita_id = r.id
    WHERE f.usuario_id = ${usuarioId}
    ORDER BY RANDOM()
    LIMIT 28
  `;

  // Completa com receitas aleatórias se precisar
  const idsFavoritos = favoritos.map((r) => r.id as number);
  const extras = idsFavoritos.length > 0
    ? await sql`
        SELECT id, titulo, foto_url, tempo_preparo, refeicao, categoria
        FROM receitas
        WHERE id <> ALL(${idsFavoritos})
        ORDER BY RANDOM()
        LIMIT 28
      `
    : await sql`
        SELECT id, titulo, foto_url, tempo_preparo, refeicao, categoria
        FROM receitas
        ORDER BY RANDOM()
        LIMIT 28
      `;

  const pool: typeof favoritos = [...favoritos, ...extras];

  // Mapeamento de refeição por slot
  const mapaRefeicao: Record<string, string[]> = {
    cafe: ["cafe_manha", "vitaminas"],
    almoco: ["pratos_dia", "saladas_leveza", "sopas_caldos"],
    lanche: ["lanches", "doces_bolos"],
    jantar: ["pratos_dia", "sopas_caldos", "grelhados", "saladas_leveza"],
  };

  const usados = new Set<number>();
  const slots: { slot: string; receitaId: number | null }[] = [];

  for (const dia of DIAS) {
    for (const ref of REFEICOES) {
      const categoriasPref = mapaRefeicao[ref] || [];
      const slotKey = `${dia}_${ref}`;

      // Tenta achar uma receita da categoria certa que não foi usada ainda
      let receita = pool.find(
        (r) => !usados.has(r.id) && (
          categoriasPref.includes(r.refeicao) ||
          categoriasPref.includes(r.categoria) ||
          r.refeicao === ref
        )
      );

      // Fallback: qualquer receita não usada
      if (!receita) {
        receita = pool.find((r) => !usados.has(r.id));
      }

      if (receita) {
        usados.add(receita.id);
        slots.push({ slot: slotKey, receitaId: receita.id });
      } else {
        slots.push({ slot: slotKey, receitaId: null });
      }
    }
  }

  // Insere no banco
  for (const s of slots) {
    await sql`
      INSERT INTO planos_semanais (usuario_id, semana, slot, receita_id)
      VALUES (${usuarioId}, ${semana}, ${s.slot}, ${s.receitaId})
      ON CONFLICT (usuario_id, semana, slot) DO UPDATE SET receita_id = EXCLUDED.receita_id
    `;
  }
}

export async function GET(req: Request) {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const uRows = await sql`SELECT tipo_usuario, trial_fim FROM usuarios WHERE id = ${session.id} LIMIT 1`;
    if (uRows.length === 0) return NextResponse.json({ erro: "Usuário não encontrado" }, { status: 404 });

    if (!isPremium(uRows[0].tipo_usuario, uRows[0].trial_fim)) {
      return NextResponse.json({ premium: false }, { status: 403 });
    }

    const semana = getMondayOfWeek(new Date());

    // Verifica se já tem plano essa semana
    const existente = await sql`
      SELECT ps.slot, ps.receita_id,
             r.titulo, r.foto_url, r.tempo_preparo, r.categoria
      FROM planos_semanais ps
      LEFT JOIN receitas r ON r.id = ps.receita_id
      WHERE ps.usuario_id = ${session.id} AND ps.semana = ${semana}
      ORDER BY ps.slot
    `;

    if (existente.length === 0) {
      await gerarPlanoAutomatico(session.id, semana);
      const novo = await sql`
        SELECT ps.slot, ps.receita_id,
               r.titulo, r.foto_url, r.tempo_preparo, r.categoria
        FROM planos_semanais ps
        LEFT JOIN receitas r ON r.id = ps.receita_id
        WHERE ps.usuario_id = ${session.id} AND ps.semana = ${semana}
        ORDER BY ps.slot
      `;
      return NextResponse.json({ semana, plano: novo, gerado: true });
    }

    return NextResponse.json({ semana, plano: existente, gerado: false });
  } catch (err) {
    console.error("plano-semanal GET error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}

export async function POST() {
  try {
    const session = await getSession();
    if (!session) return NextResponse.json({ erro: "Não autenticado" }, { status: 401 });

    const uRows = await sql`SELECT tipo_usuario, trial_fim FROM usuarios WHERE id = ${session.id} LIMIT 1`;
    if (!isPremium(uRows[0]?.tipo_usuario, uRows[0]?.trial_fim)) {
      return NextResponse.json({ premium: false }, { status: 403 });
    }

    const semana = getMondayOfWeek(new Date());

    // Deleta plano atual e regenera
    await sql`DELETE FROM planos_semanais WHERE usuario_id = ${session.id} AND semana = ${semana}`;
    await gerarPlanoAutomatico(session.id, semana);

    const novo = await sql`
      SELECT ps.slot, ps.receita_id,
             r.titulo, r.foto_url, r.tempo_preparo, r.categoria
      FROM planos_semanais ps
      LEFT JOIN receitas r ON r.id = ps.receita_id
      WHERE ps.usuario_id = ${session.id} AND ps.semana = ${semana}
      ORDER BY ps.slot
    `;

    return NextResponse.json({ semana, plano: novo, gerado: true });
  } catch (err) {
    console.error("plano-semanal POST error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
