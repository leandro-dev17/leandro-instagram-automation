import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";
import { enviarSaudadeVovo } from "@/lib/reengajamento";

// Engajamento baseado em favoritos adicionados nos últimos 7 / 30 dias
// Alunas com tipo_usuario = 'aluna_leandro'

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const alunas = await sql`
      SELECT u.id, u.nome, u.email
      FROM usuarios u
      WHERE u.tipo_usuario = 'aluna_leandro'
      ORDER BY u.id
    `;

    if (alunas.length === 0) {
      await resolverFalhas("monitor-alunas");
      return NextResponse.json({ ok: true, msg: "Nenhuma aluna cadastrada ainda" });
    }

    // Contagem total de favoritos por aluna (favoritos não tem created_at)
    const favsTotais = await sql`
      SELECT usuario_id, COUNT(*) as total
      FROM favoritos
      GROUP BY usuario_id
    ` as { usuario_id: number; total: number }[];

    // Plano semanal mais recente por aluna (semana = data da segunda-feira, 'YYYY-MM-DD')
    const planosRecentes = await sql`
      SELECT DISTINCT ON (usuario_id) usuario_id, semana
      FROM planos_semanais
      ORDER BY usuario_id, semana DESC
    `.catch(() => [] as { usuario_id: number; semana: string }[]);

    const mapFavs  = new Map<number, number>(favsTotais.map(r => [r.usuario_id, Number(r.total)] as [number, number]));
    const mapPlano = new Map<number, string>(planosRecentes.map(r => [r.usuario_id, r.semana] as [number, string]));

    const hoje = new Date();
    const diaSemana = hoje.getDay();
    const diffSegunda = diaSemana === 0 ? -6 : 1 - diaSemana;
    const segundaFeira = new Date(hoje);
    segundaFeira.setDate(hoje.getDate() + diffSegunda);
    const semanaAtual = segundaFeira.toISOString().slice(0, 10);

    const ativas:     string[] = [];
    const poucoAtiva: string[] = [];
    const inativas:   string[] = [];
    let mensagens_enviadas = 0;

    for (const a of alunas as { id: number; nome: string; email: string }[]) {
      const favs       = mapFavs.get(a.id) ?? 0;
      const ultimoPlano = mapPlano.get(a.id) ?? null;
      const usouEssaSemana = ultimoPlano === semanaAtual;

      if (favs >= 5 || usouEssaSemana) {
        ativas.push(`✅ ${a.nome} (${favs} favs${usouEssaSemana ? ", plano semanal ativo" : ""})`);
      } else if (favs >= 1) {
        poucoAtiva.push(`⚠️ ${a.nome} (${favs} favs no total)`);
      } else {
        inativas.push(`🔴 ${a.nome} — sem favoritos nem plano semanal`);
        const enviada = await enviarSaudadeVovo(a.id);
        if (enviada) mensagens_enviadas++;
      }
    }

    const total = alunas.length;
    const semana = new Date().toLocaleDateString("pt-BR");

    let msg = `👩‍🍳 <b>Monitor de Alunas — ${semana}</b>\n\n`;
    // semanaAtual já definida acima
    msg += `Total: ${total} alunas\n`;
    msg += `Ativas (7 dias): ${ativas.length} · Pouco ativas: ${poucoAtiva.length} · Inativas: ${inativas.length}\n\n`;

    if (ativas.length)     msg += `<b>Ativas:</b>\n${ativas.join("\n")}\n\n`;
    if (poucoAtiva.length) msg += `<b>Pouco ativas:</b>\n${poucoAtiva.join("\n")}\n\n`;
    if (inativas.length)   msg += `<b>Inativas ⚠️:</b>\n${inativas.join("\n")}\n\n`;

    msg += `<i>Engajamento medido por favoritos adicionados.</i>`;

    await enviarTelegram(msg);

    await resolverFalhas("monitor-alunas");
    return NextResponse.json({
      ok: true,
      total,
      ativas: ativas.length,
      poucoAtiva: poucoAtiva.length,
      inativas: inativas.length,
      mensagens_enviadas,
    });
  } catch (err) {
    await reportarFalha("monitor-alunas", String(err));
    return NextResponse.json({ erro: "Erro no monitor de alunas", detalhes: String(err) }, { status: 500 });
  }
}
