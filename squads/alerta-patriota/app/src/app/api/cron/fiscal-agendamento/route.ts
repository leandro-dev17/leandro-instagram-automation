import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarTelegram, alertarTelegram } from "@/lib/telegram";

const GITHUB_ACTIONS_URL =
  "https://github.com/leandro-dev17/leandro-instagram-automation/actions";

type GrupoTipo = "todos" | "vip_elite";

type JanelaPublicacao = {
  horarioBRT: number;
  label: string;
  grupos: GrupoTipo;
  // Janela de verificação: início e fim em hora BRT (decimal)
  verificacaoInicioBRT: number;
  verificacaoFimBRT: number;
  // Janela de tempo em que o card deveria ter sido gerado (BRT → UTC offset -3h)
  cardDesdeHoraBRT: number;
};

const JANELAS: JanelaPublicacao[] = [
  // Horários para todos os grupos (cron 0 9,15,21 UTC = 6h, 12h, 18h BRT)
  // Verificação: 30min–90min após o horário
  {
    horarioBRT: 7,
    label: "7h",
    grupos: "todos",
    verificacaoInicioBRT: 7.5,
    verificacaoFimBRT: 9.0,
    cardDesdeHoraBRT: 6.5,
  },
  {
    horarioBRT: 13,
    label: "13h",
    grupos: "todos",
    verificacaoInicioBRT: 13.5,
    verificacaoFimBRT: 15.0,
    cardDesdeHoraBRT: 12.5,
  },
  {
    horarioBRT: 19,
    label: "19h",
    grupos: "todos",
    verificacaoInicioBRT: 19.5,
    verificacaoFimBRT: 21.0,
    cardDesdeHoraBRT: 18.5,
  },
  // Horários extras VIP+Elite (cron 0 13,19,1 UTC = 10h, 16h, 22h BRT)
  {
    horarioBRT: 10,
    label: "10h",
    grupos: "vip_elite",
    verificacaoInicioBRT: 10.5,
    verificacaoFimBRT: 12.0,
    cardDesdeHoraBRT: 9.5,
  },
  {
    horarioBRT: 16,
    label: "16h",
    grupos: "vip_elite",
    verificacaoInicioBRT: 16.5,
    verificacaoFimBRT: 18.0,
    cardDesdeHoraBRT: 15.5,
  },
  {
    horarioBRT: 22,
    label: "22h",
    grupos: "vip_elite",
    verificacaoInicioBRT: 22.5,
    verificacaoFimBRT: 24.0,
    cardDesdeHoraBRT: 21.5,
  },
];

function agoraHoraBRT(): number {
  const agora = new Date();
  const brt = new Date(agora.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  return brt.getHours() + brt.getMinutes() / 60;
}

function horaBRTParaUTC(horaBRT: number): Date {
  const hoje = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const horaInteira = Math.floor(horaBRT);
  const minutos = Math.round((horaBRT - horaInteira) * 60);
  // BRT = UTC - 3h
  const utcHora = horaInteira + 3;
  const dataUTC = new Date(`${hoje}T${String(utcHora).padStart(2, "0")}:${String(minutos).padStart(2, "0")}:00Z`);
  return dataUTC;
}

async function verificarCardGerado(cardDesdeHoraBRT: number, fimVerificacaoBRT: number): Promise<boolean> {
  const inicio = horaBRTParaUTC(cardDesdeHoraBRT);
  const fim = horaBRTParaUTC(fimVerificacaoBRT);

  const rows = await sql`
    SELECT id FROM agentes_log
    WHERE agente = 'gerador-card'
      AND acao LIKE 'card_%'
      AND status = 'sucesso'
      AND created_at >= ${inicio.toISOString()}::timestamptz
      AND created_at <= ${fim.toISOString()}::timestamptz
    LIMIT 1
  `;

  return rows.length > 0;
}

function gruposAfetados(tipo: GrupoTipo): string[] {
  if (tipo === "todos") return ["vip", "elite"];
  return ["vip", "elite"];
}

function cronEsperado(horarioBRT: number): string {
  const utcHora = (horarioBRT + 3) % 24;
  return `${String(utcHora).padStart(2, "0")}:00 UTC`;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  const horaBRT = agoraHoraBRT();

  // Não alerta antes das 7h30 BRT (primeiro horário do dia)
  if (horaBRT < 7.5) {
    return NextResponse.json({
      ok: true,
      motivo: "Antes do primeiro horário do dia (7h30 BRT)",
      hora_brt: horaBRT.toFixed(2),
      duracao_ms: Date.now() - inicio,
    });
  }

  type ResultadoJanela = {
    horario: string;
    grupos: GrupoTipo;
    janela_ativa: boolean;
    card_gerado: boolean | null;
    alerta_disparado: boolean;
  };

  const resultados: ResultadoJanela[] = [];
  const alertasDisparados: string[] = [];

  try {
    for (const janela of JANELAS) {
      const janelaAtiva =
        horaBRT >= janela.verificacaoInicioBRT && horaBRT <= janela.verificacaoFimBRT;

      if (!janelaAtiva) {
        resultados.push({
          horario: janela.label,
          grupos: janela.grupos,
          janela_ativa: false,
          card_gerado: null,
          alerta_disparado: false,
        });
        continue;
      }

      const cardGerado = await verificarCardGerado(janela.cardDesdeHoraBRT, janela.verificacaoFimBRT);

      if (!cardGerado) {
        const grupos = gruposAfetados(janela.grupos);
        const horaBRTAtualFormatada = new Date().toLocaleString("pt-BR", {
          timeZone: "America/Sao_Paulo",
          hour: "2-digit",
          minute: "2-digit",
        });
        const cronEsp = cronEsperado(janela.horarioBRT);

        const linhas = [
          `⏰ PEDRO PONTUAL — Publicação Atrasada!`,
          `Horário ${janela.label}: card não publicado (${horaBRTAtualFormatada} BRT)`,
          ``,
          `Grupos afetados: ${grupos.join(", ")}`,
          `O cron deveria ter rodado às ${cronEsp} (${janela.horarioBRT.toString().padStart(2, "0")}:00 BRT).`,
          ``,
          `Verifique os logs do GitHub Actions:`,
          GITHUB_ACTIONS_URL,
        ];

        await enviarTelegram(linhas.join("\n"));

        const mensagemAlerta = `Card das ${janela.label} não publicado. Grupos: ${grupos.join(", ")}. Cron esperado: ${cronEsp}.`;
        alertasDisparados.push(mensagemAlerta);

        await sql`
          INSERT INTO alertas (tipo, severidade, mensagem)
          VALUES ('publicacao_atrasada', 'alto', ${mensagemAlerta})
        `;

        resultados.push({
          horario: janela.label,
          grupos: janela.grupos,
          janela_ativa: true,
          card_gerado: false,
          alerta_disparado: true,
        });
      } else {
        resultados.push({
          horario: janela.label,
          grupos: janela.grupos,
          janela_ativa: true,
          card_gerado: true,
          alerta_disparado: false,
        });
      }
    }

    const duracao = Date.now() - inicio;
    const tudoOk = alertasDisparados.length === 0;

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES (
        'pedro-pontual',
        'verificar_agendamento',
        ${tudoOk ? "sucesso" : "aviso"},
        ${JSON.stringify({
          hora_brt: horaBRT.toFixed(2),
          janelas_verificadas: resultados.filter((r) => r.janela_ativa).length,
          alertas_disparados: alertasDisparados.length,
          detalhes: resultados,
        })},
        ${duracao}
      )
    `;

    return NextResponse.json({
      ok: tudoOk,
      hora_brt: horaBRT.toFixed(2),
      janelas: resultados,
      alertas_disparados: alertasDisparados.length,
      duracao_ms: duracao,
    });
  } catch (err) {
    const duracao = Date.now() - inicio;
    await alertarTelegram("🚨", "PEDRO PONTUAL — ERRO CRÍTICO", String(err));
    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('pedro-pontual', 'verificar_agendamento', 'erro', ${JSON.stringify({ erro: String(err) })}, ${duracao})
    `.catch(() => {});
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
