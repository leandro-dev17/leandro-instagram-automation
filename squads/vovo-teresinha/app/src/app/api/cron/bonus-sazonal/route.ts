import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";

type DataEspecial = {
  nome: string;
  chave: string;
  desconto: number;
  // formato "MM-DD", aceita wrap de ano (ex: Ano Novo vai de 12-26 a 01-03)
  inicio: string;
  fim: string;
  wraparound?: boolean;
};

const CALENDARIO: DataEspecial[] = [
  { nome: "Dia das Mães", chave: "bonus_dia_maes", desconto: 20, inicio: "05-05", fim: "05-12" },
  { nome: "Festa Junina", chave: "bonus_junina", desconto: 15, inicio: "06-01", fim: "06-30" },
  { nome: "Dia dos Pais", chave: "bonus_dia_pais", desconto: 20, inicio: "08-03", fim: "08-10" },
  { nome: "Natal", chave: "bonus_natal", desconto: 25, inicio: "12-10", fim: "12-25" },
  { nome: "Ano Novo", chave: "bonus_ano_novo", desconto: 15, inicio: "12-26", fim: "01-03", wraparound: true },
];

function isAtiva(inicio: string, fim: string, wraparound = false): boolean {
  const hoje = new Date();
  const mesStr = String(hoje.getMonth() + 1).padStart(2, "0");
  const diaStr = String(hoje.getDate()).padStart(2, "0");
  const hojeStr = `${mesStr}-${diaStr}`;
  if (wraparound) {
    // Período que cruza a virada do ano (ex: 12-26 a 01-03)
    return hojeStr >= inicio || hojeStr <= fim;
  }
  return hojeStr >= inicio && hojeStr <= fim;
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  try {
    const ativados: string[] = [];
    const desativados: string[] = [];

    for (const data of CALENDARIO) {
      const ativa = isAtiva(data.inicio, data.fim, data.wraparound);

      const atual = await sql`
        SELECT valor FROM app_configuracoes WHERE chave = ${data.chave}
      `;
      const estaAtivo = atual.length > 0 && atual[0].valor === "true";

      if (ativa && !estaAtivo) {
        await sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${data.chave}, 'true')
          ON CONFLICT (chave) DO UPDATE SET valor = 'true', updated_at = NOW()
        `;
        await sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${data.chave + "_desconto"}, ${String(data.desconto)})
          ON CONFLICT (chave) DO UPDATE SET valor = ${String(data.desconto)}, updated_at = NOW()
        `;
        ativados.push(`${data.nome} (${data.desconto}% off)`);
      } else if (!ativa && estaAtivo) {
        await sql`
          INSERT INTO app_configuracoes (chave, valor)
          VALUES (${data.chave}, 'false')
          ON CONFLICT (chave) DO UPDATE SET valor = 'false', updated_at = NOW()
        `;
        desativados.push(data.nome);
      }
    }

    if (ativados.length > 0 || desativados.length > 0) {
      const msg =
        `🎁 <b>Bônus Sazonal — Atualização</b>\n` +
        `📅 ${new Date().toLocaleDateString("pt-BR")}\n\n` +
        (ativados.length > 0
          ? `✅ <b>Bônus ativados:</b>\n${ativados.map((b) => `• ${b}`).join("\n")}\n\n`
          : "") +
        (desativados.length > 0
          ? `❌ <b>Bônus encerrados:</b>\n${desativados.map((b) => `• ${b}`).join("\n")}`
          : "");
      await enviarTelegram(msg);
    }

    return NextResponse.json({ ok: true, ativados, desativados });
  } catch (err) {
    console.error("bonus-sazonal error", err);
    return NextResponse.json({ erro: "Erro interno" }, { status: 500 });
  }
}
