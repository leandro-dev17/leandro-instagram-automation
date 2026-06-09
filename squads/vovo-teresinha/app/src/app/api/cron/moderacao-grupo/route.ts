import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { enviarTelegram } from "@/lib/telegram";
import { cronAutorizado } from "@/lib/auth-cron";
import { reportarFalha, resolverFalhas } from "@/lib/agente-falha";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INSTANCE = process.env.EVOLUTION_INSTANCE || "vovo-teresinha";
const WPP_GRUPO_ID = process.env.EVOLUTION_GRUPO_ID;

interface ParticipanteGrupo {
  id: string;
  admin: boolean;
}

async function buscarParticipantesGrupo(): Promise<ParticipanteGrupo[]> {
  if (!EVO_URL || !EVO_KEY || !WPP_GRUPO_ID) return [];
  try {
    const res = await fetch(`${EVO_URL}/group/participants/${EVO_INSTANCE}?groupJid=${WPP_GRUPO_ID}`, {
      headers: { apikey: EVO_KEY },
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.participants || []).map((p: { id: string; admin: string | null }) => ({
      id: p.id,
      admin: p.admin === "admin" || p.admin === "superadmin",
    }));
  } catch {
    return [];
  }
}

export async function GET(req: NextRequest) {
  if (!cronAutorizado(req)) {
    return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });
  }

  if (!EVO_URL || !EVO_KEY || !WPP_GRUPO_ID) {
    return NextResponse.json({ ok: true, msg: "Evolution API ou grupo não configurado — pulando" });
  }

  try {
    const participantes = await buscarParticipantesGrupo();
    const hoje = new Date().toISOString().split("T")[0];
    const alertas: string[] = [];

    // Registra contagem diária
    const [ultimaContagem] = await sql`
      SELECT valor FROM app_configuracoes
      WHERE chave = 'grupo_wpp_ultima_contagem'
    `;

    const contagemAnterior = ultimaContagem ? Number(ultimaContagem.valor) : 0;
    const contagemAtual = participantes.length;
    const variacao = contagemAtual - contagemAnterior;

    // Alerta se saíram muitas pessoas
    if (contagemAnterior > 0 && variacao < -5) {
      alertas.push(`⚠️ ${Math.abs(variacao)} pessoas saíram do grupo WPP hoje!`);
    }

    // Verifica admins suspeitos (novos admins não reconhecidos)
    const adminsConhecidos = await sql`
      SELECT valor FROM app_configuracoes WHERE chave = 'grupo_wpp_admins_conhecidos'
    `;
    const listaConhecidos: string[] = adminsConhecidos.length > 0
      ? JSON.parse(adminsConhecidos[0].valor || "[]")
      : [];

    const adminsAtuais = participantes.filter(p => p.admin).map(p => p.id);
    const novosAdmins = adminsAtuais.filter(a => !listaConhecidos.includes(a) && listaConhecidos.length > 0);

    if (novosAdmins.length > 0) {
      alertas.push(`🚨 Novos admins no grupo WPP: ${novosAdmins.join(", ")}`);
    }

    // Atualiza registros
    await Promise.all([
      sql`
        INSERT INTO app_configuracoes (chave, valor)
        VALUES ('grupo_wpp_ultima_contagem', ${contagemAtual.toString()})
        ON CONFLICT (chave) DO UPDATE SET valor = ${contagemAtual.toString()}
      `,
      sql`
        INSERT INTO app_configuracoes (chave, valor)
        VALUES ('grupo_wpp_admins_conhecidos', ${JSON.stringify(adminsAtuais)})
        ON CONFLICT (chave) DO UPDATE SET valor = ${JSON.stringify(adminsAtuais)}
      `,
      sql`
        INSERT INTO app_configuracoes (chave, valor)
        VALUES (${`grupo_wpp_contagem_${hoje}`}, ${contagemAtual.toString()})
        ON CONFLICT (chave) DO UPDATE SET valor = ${contagemAtual.toString()}
      `,
    ]);

    if (alertas.length > 0) {
      await enviarTelegram(
        `👥 <b>Moderação Grupo WhatsApp</b>\n\n` +
        `Membros: ${contagemAtual} (${variacao >= 0 ? "+" : ""}${variacao} hoje)\n\n` +
        alertas.join("\n")
      );
    }

    await resolverFalhas("moderacao-grupo");
    return NextResponse.json({ ok: true, membros: contagemAtual, variacao, alertas });
  } catch (err) {
    await reportarFalha("moderacao-grupo", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
