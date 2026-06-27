/**
 * AGENTE ENZO ENGAJAMENTO
 * Roda 3x/dia (9h, 15h, 21h UTC). Cuida de:
 * - Trial expirando em D-6: lembrete no WhatsApp
 * - Inativos: 6 ondas de reengajamento (e-mail + WhatsApp), a cada 5 dias
 *   D5, D10, D15, D20, D25, D30 — ondas D20/D25/D30 incluem oferta Elite
 *   Anual com desconto crescente (10%/15%/20%)
 */
import { NextRequest, NextResponse } from "next/server";
import { sql } from "@/lib/db";
import { verificarCronSecret } from "@/lib/auth";
import { enviarMensagemPrivada } from "@/lib/whatsapp";
import { enviarEmailReengajamento } from "@/lib/brevo";
import { alertarTelegram } from "@/lib/telegram";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

type DiasOnda = 5 | 10 | 15 | 20 | 25 | 30;

interface Onda {
  dias: DiasOnda;
  acao: string;
  dedupDias: number;
}

const ONDAS: Onda[] = [
  { dias: 5,  acao: "onda_5",  dedupDias: 5  },
  { dias: 10, acao: "onda_10", dedupDias: 5  },
  { dias: 15, acao: "onda_15", dedupDias: 5  },
  { dias: 20, acao: "onda_20", dedupDias: 5  },
  { dias: 25, acao: "onda_25", dedupDias: 5  },
  { dias: 30, acao: "onda_30", dedupDias: 60 },
];

function mensagemWhatsApp(dias: DiasOnda, nome: string): string {
  switch (dias) {
    case 5:
      return `🇧🇷 *${nome}, sentimos sua falta!*\n\nFaz 5 dias que você não aparece. O grupo continua trazendo as notícias que a mídia esconde.\n\nDá uma olhada: ${APP_URL}\n\n_Capitão Braga — Deus, Pátria e Família._`;
    case 10:
      return `📰 *${nome}, muita coisa aconteceu essa semana*\n\nO Capitão Braga comentou os principais acontecimentos e o grupo debateu tudo. Não perca o próximo.\n\n${APP_URL}\n\n_Deus, Pátria e Família — sempre._`;
    case 15:
      return `🇧🇷 *${nome}, está tudo bem?*\n\nO Capitão Braga notou sua ausência. O grupo está cheio de novidades e o Brasil precisa de patriotas atentos!\n\n${APP_URL}\n\n_Deus, Pátria e Família — sempre._`;
    case 20:
      return `🎁 *${nome}, preparamos algo especial para você*\n\nElite Global Anual com 10% de desconto — de R$199 por R$179,10/ano.\n\nGarantir: ${APP_URL}/assinar?plano=elite&ciclo=anual&cupom=VOLTA10\n\n_Capitão Braga._`;
    case 25:
      return `⚠️ *${nome}, sua vaga pode ser liberada em breve*\n\nAinda dá tempo: Elite Global Anual com 15% de desconto — de R$199 por R$169,15/ano.\n\n${APP_URL}/assinar?plano=elite&ciclo=anual&cupom=VOLTA15\n\n_Capitão Braga._`;
    case 30:
      return `🎁 *${nome}, esta é a última mensagem que vou te enviar*\n\nSentimos sua falta de verdade. Última chance: Elite Global Anual com 20% de desconto — de R$199 por R$159,20/ano.\n\n${APP_URL}/assinar?plano=elite&ciclo=anual&cupom=VOLTA20\n\n_Capitão Braga — Deus, Pátria e Família — sempre._`;
  }
}

async function buscarInativos(onda: Onda) {
  const min = onda.dias;
  const max = onda.dias < 30 ? onda.dias + 5 : null;
  const dedup = onda.dedupDias;

  // FASE 27.5: o dedup excluía o usuário se EXISTISSE qualquer log da onda na janela,
  // sem checar status — uma falha de envio (status='erro') bloqueava qualquer nova
  // tentativa pelo resto da janela de dedup (5 ou 60 dias), igual ao bug já corrigido
  // em campanha-recuperacao.ts. Adicionado status = 'sucesso' para permitir retentativa.
  if (max !== null) {
    return sql`
      SELECT id, nome, email, telefone, plano FROM usuarios
      WHERE status = 'ativo'
        AND updated_at < NOW() - INTERVAL '1 day' * ${min}
        AND updated_at >= NOW() - INTERVAL '1 day' * ${max}
        AND id NOT IN (
          SELECT (detalhes->>'usuarioId')::int FROM agentes_log
          WHERE agente = 'enzo-engajamento' AND acao = ${onda.acao} AND status = 'sucesso'
            AND created_at >= NOW() - INTERVAL '1 day' * ${dedup}
            AND detalhes->>'usuarioId' IS NOT NULL
        )
      LIMIT 40
    `;
  }

  // onda_30: sem limite superior (30+ dias inativos)
  return sql`
    SELECT id, nome, email, telefone, plano FROM usuarios
    WHERE status = 'ativo'
      AND updated_at < NOW() - INTERVAL '30 days'
      AND id NOT IN (
        SELECT (detalhes->>'usuarioId')::int FROM agentes_log
        WHERE agente = 'enzo-engajamento' AND acao = ${onda.acao} AND status = 'sucesso'
          AND created_at >= NOW() - INTERVAL '1 day' * ${dedup}
          AND detalhes->>'usuarioId' IS NOT NULL
      )
    LIMIT 20
  `;
}

export async function GET(req: NextRequest) {
  if (!verificarCronSecret(req)) return NextResponse.json({ erro: "Não autorizado" }, { status: 401 });

  const inicio = Date.now();
  let acoes = 0;

  try {
    // ── 1. Trial expirando em 6 dias ─────────────────────────────────────
    // FASE 17: essa rota roda 3x/dia e a janela de elegibilidade (trial_fim
    // entre 5 e 7 dias) dura ~2 dias — sem deduplicação, o mesmo trial recebia
    // o lembrete várias vezes ao dia, todos os dias na janela. Agora segue o
    // mesmo padrão de dedup das ondas de reengajamento abaixo.
    const trialsD6 = await sql`
      SELECT id, nome, telefone, plano FROM usuarios
      WHERE status = 'trial'
        AND trial_fim BETWEEN NOW() + INTERVAL '5 days' AND NOW() + INTERVAL '7 days'
        AND telefone IS NOT NULL
        AND id NOT IN (
          SELECT (detalhes->>'usuarioId')::int FROM agentes_log
          WHERE agente = 'enzo-engajamento' AND acao = 'trial_d6' AND status = 'sucesso'
            AND created_at >= NOW() - INTERVAL '7 days'
            AND detalhes->>'usuarioId' IS NOT NULL
        )
    `;

    for (const u of trialsD6) {
      const msg = `⏰ *${u.nome}, seus 7 dias estão acabando!*\n\nVocê ainda tem acesso ao Alerta Patriota por poucos dias. Não fique sem as notícias que a mídia esconde.\n\nManter minha assinatura: ${APP_URL}/assinar\n\n_Capitão Braga — Deus, Pátria e Família._`;
      const enviado = await enviarMensagemPrivada(u.telefone, msg, u.plano);
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('enzo-engajamento', 'trial_d6', ${enviado ? "sucesso" : "erro"}, ${JSON.stringify({ usuarioId: u.id })})
      `;
      acoes++;
    }

    // ── 2. Ondas de reengajamento (D5 → D30) ─────────────────────────────
    for (const onda of ONDAS) {
      const inativos = await buscarInativos(onda);

      for (const u of inativos) {
        // FASE 23: status 'sucesso' era gravado incondicionalmente, mesmo que e-mail e
        // WhatsApp falhassem os dois — mascarando falhas reais de entrega na onda.
        let emailOk = false;
        let whatsappOk = false;
        if (u.email) {
          emailOk = await enviarEmailReengajamento(u.email, u.nome, onda.dias).catch(() => false);
        }
        if (u.telefone) {
          whatsappOk = await enviarMensagemPrivada(u.telefone, mensagemWhatsApp(onda.dias, u.nome), u.plano);
        }
        const algumEnvioOk = (u.email ? emailOk : true) && (u.telefone ? whatsappOk : true);
        await sql`
          INSERT INTO agentes_log (agente, acao, status, detalhes)
          VALUES ('enzo-engajamento', ${onda.acao}, ${algumEnvioOk ? "sucesso" : "erro"}, ${JSON.stringify({ usuarioId: u.id, emailOk, whatsappOk })})
        `;
        acoes++;
      }
    }

    await sql`
      INSERT INTO agentes_log (agente, acao, status, detalhes, duracao_ms)
      VALUES ('enzo-engajamento', 'ciclo_completo', 'sucesso', ${JSON.stringify({ acoes })}, ${Date.now() - inicio})
    `;
    return NextResponse.json({ ok: true, acoes });
  } catch (err) {
    await alertarTelegram("🔴", "Falha Agente Enzo Engajamento", String(err));
    return NextResponse.json({ erro: String(err) }, { status: 500 });
  }
}
