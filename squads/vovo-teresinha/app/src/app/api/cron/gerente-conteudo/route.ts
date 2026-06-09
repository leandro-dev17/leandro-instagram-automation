import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const CRON_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  const alertas: string[] = [];

  try {
    // Contagem de receitas por categoria
    const porCategoria = await sql`
      SELECT categoria, COUNT(*) as total FROM receitas GROUP BY categoria ORDER BY total ASC
    `;

    // Receitas free rotativa ativas
    const [freeAtivas] = await sql`
      SELECT COUNT(*) as total FROM receitas WHERE is_free_rotativa = TRUE
    `;

    // Total de receitas
    const [totalReceitas] = await sql`SELECT COUNT(*) as total FROM receitas`;

    const nFree = Number(freeAtivas.total);
    const nTotal = Number(totalReceitas.total);

    // Alerta se alguma categoria tem menos de 5 receitas
    const categoriasBaixas = porCategoria.filter(c => Number(c.total) < 5);
    if (categoriasBaixas.length > 0) {
      alertas.push(`Categorias com < 5 receitas: ${categoriasBaixas.map(c => `${c.categoria}(${c.total})`).join(", ")}`);
      // Dispara criador de receitas para preencher
      if (CRON_SECRET) {
        fetch(`${APP_URL}/api/cron/criador-receitas?secret=${CRON_SECRET}`, {
          signal: AbortSignal.timeout(60000),
        }).catch(() => {});
      }
    }

    if (nFree < 20) {
      alertas.push(`Poucas receitas free rotativas: ${nFree} (mínimo recomendado: 40)`);
    }

    const hora = new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
    await enviarTelegram(
      `📝 <b>Gerente de Conteúdo — ${hora}</b>\n\n` +
      `📚 Total de receitas: ${nTotal}\n` +
      `🆓 Free rotativas: ${nFree}\n` +
      (alertas.length > 0
        ? `\n` + alertas.map(a => `⚠️ ${a}`).join("\n") + `\n\n🤖 Criador de receitas acionado automaticamente.`
        : `\n✅ Conteúdo em dia.`)
    );

    return NextResponse.json({ ok: alertas.length === 0, alertas, nTotal, nFree });
  } catch (err) {
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
