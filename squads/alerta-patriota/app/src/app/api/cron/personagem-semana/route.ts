/**
 * AGENTE PERSONAGEM DA SEMANA — Elite Global
 * Toda segunda-feira às 15h apresenta uma personalidade conservadora global
 * com análise do Prof. Bernardo Cavalcanti.
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { alertarTelegram } from "@/lib/telegram";
import { enviarMensagemGrupo } from "@/lib/whatsapp";
import { gerarTexto } from "@/lib/ai";

// Rodízio de personalidades conservadoras globais
const PERSONALIDADES = [
  { nome: "Javier Milei",     pais: "Argentina", cargo: "Presidente da Argentina",            tema: "libertarismo e corte de gastos públicos" },
  { nome: "Elon Musk",        pais: "EUA",       cargo: "CEO Tesla/SpaceX, dono do X",        tema: "liberdade de expressão e tecnologia" },
  { nome: "Donald Trump",     pais: "EUA",       cargo: "45º e 47º Presidente dos EUA",       tema: "America First e conservadorismo populista" },
  { nome: "Viktor Orbán",     pais: "Hungria",   cargo: "Primeiro-Ministro da Hungria",       tema: "soberania nacional e família cristã" },
  { nome: "Peter Thiel",      pais: "EUA",       cargo: "Investidor e filósofo conservador",  tema: "tecnologia, liberdade e crítica à globalização" },
  { nome: "Giorgia Meloni",   pais: "Itália",    cargo: "Primeira-Ministra da Itália",        tema: "conservadorismo cristão e identidade europeia" },
  { nome: "Santiago Abascal", pais: "Espanha",   cargo: "Líder do partido Vox",              tema: "soberania espanhola e valores conservadores" },
  { nome: "Jordan Peterson",  pais: "Canadá",    cargo: "Psicólogo e intelectual conservador",tema: "responsabilidade individual e crítica ao marxismo cultural" },
];

async function gerarPerfil(p: typeof PERSONALIDADES[0], semana: number): Promise<string> {
  const texto = await gerarTexto({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 500,
    messages: [{ role: "user", content: `Você é o Prof. Bernardo Cavalcanti.
Apresente ${p.nome} (${p.cargo}, ${p.pais}) em 6-8 linhas para brasileiros conservadores.
- Quem é, o que defende, por que importa para o Brasil
- Foco em: ${p.tema}
- Conecte ao que esse pensamento significa para o futuro do Brasil
- Tom analítico e inspirador
Termine com: "O mundo muda para quem enxerga antes."
Responda APENAS com o texto.` }],
  });
  return texto;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  try {
    // Só roda às segundas
    if (new Date().getDay() !== 1) return NextResponse.json({ ok: true, motivo: "só roda às segundas" });

    // Escolhe personalidade da semana por rotação
    const semana = Math.floor(Date.now() / (7 * 24 * 60 * 60 * 1000));
    const p = PERSONALIDADES[semana % PERSONALIDADES.length];

    // Verifica se já enviou esta semana
    const jaEnviou = await sql`
      SELECT id FROM agentes_log
      WHERE agente = 'personagem-semana'
      AND created_at >= NOW() - INTERVAL '6 days'
      LIMIT 1
    `;
    if (jaEnviou.length > 0) return NextResponse.json({ ok: true, motivo: "já enviado esta semana" });

    const perfil = await gerarPerfil(p, semana);
    if (!perfil) return NextResponse.json({ ok: false, motivo: "sem perfil gerado" });

    const msg = `🎯 *PERSONALIDADE DA SEMANA — Elite Global*\n\n👤 *${p.nome}*\n🌍 ${p.cargo} · ${p.pais}\n\n${perfil}`;

    await enviarMensagemGrupo("elite", msg);

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('personagem-semana', 'enviar_perfil', 'sucesso',
        ${JSON.stringify({ personalidade: p.nome, pais: p.pais })})
    `;

    return NextResponse.json({ ok: true, personalidade: p.nome });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Personagem da Semana", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes)
      VALUES ('personagem-semana', 'enviar_perfil', 'erro', ${JSON.stringify({ erro: String(err) })})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
