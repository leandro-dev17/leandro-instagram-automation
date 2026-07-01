/**
 * AGENTE REGINA RECEPÇÃO
 * Webhook da Evolution API — detecta entrada de novos membros nos grupos
 * e envia boas-vindas automáticas no tom da persona correta.
 */

import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "crypto";
import { sql } from "@/lib/db";
import { enviarMensagemGrupo, buildBoasVindasGrupo } from "@/lib/whatsapp";
import type { Plano } from "@/lib/db";

// Mapeia group_id_wa → plano
async function getPlanoByGroupId(groupId: string): Promise<Plano | null> {
  const rows = await sql`SELECT plano FROM grupos_whatsapp WHERE group_id_wa = ${groupId} AND ativo = true LIMIT 1`;
  return rows.length > 0 ? (rows[0].plano as Plano) : null;
}

// Busca usuário pelo telefone
async function getUsuarioByTelefone(telefone: string) {
  const numero = telefone.replace(/\D/g, "").replace(/^55/, "");
  const rows = await sql`
    SELECT id, nome, plano FROM usuarios
    WHERE telefone LIKE ${"%" + numero.slice(-8)}
    AND status = 'ativo'
    LIMIT 1
  `;
  return rows[0] || null;
}

// Grupos VIP e Elite onde o bot responde mensagens dos membros
const GRUPOS_BOT: Record<string, "vip" | "elite"> = {
  [process.env.WPP_GROUP_VIP  || ""]: "vip",
  [process.env.WPP_GROUP_ELITE || ""]: "elite",
};

// Palavras-chave que ativam o bot (pergunta ou menção a política)
const PALAVRAS_BOT = [
  "capitão", "professor", "braga", "cavalcanti", "o que você acha",
  "qual sua opinião", "comente", "analise", "explica", "por que",
  "http", "https", "www", "youtube", "youtu.be",
  "stf", "lula", "bolsonaro", "nikolas", "congresso", "senado",
  "imposto", "economia", "dólar", "inflação",
];

function deveBotResponder(texto: string): boolean {
  const lower = texto.toLowerCase();
  return PALAVRAS_BOT.some(p => lower.includes(p));
}

// Valida que a requisição vem da Evolution API.
// O secret é enviado via query string na própria URL do webhook (mais confiável do
// que depender de header customizado — nem toda versão da Evolution API garante isso),
// com fallback para o header x-webhook-secret caso ele seja enviado também.
// Comparação em tempo constante (timingSafeEqual) — mesmo padrão de verificarCronSecret().
function validarOrigemEvolution(req: NextRequest): boolean {
  const secret = process.env.EVOLUTION_WEBHOOK_SECRET;
  if (!secret) {
    console.error("EVOLUTION_WEBHOOK_SECRET não configurada — rejeitando webhook");
    return false;
  }
  const secretBuf = Buffer.from(secret);
  const comparar = (v: string | null): boolean => {
    if (!v) return false;
    const buf = Buffer.from(v);
    return buf.length === secretBuf.length && timingSafeEqual(buf, secretBuf);
  };
  const secretQuery = new URL(req.url).searchParams.get("secret");
  return comparar(secretQuery) || comparar(req.headers.get("x-webhook-secret"));
}

export async function POST(req: NextRequest) {
  try {
    if (!validarOrigemEvolution(req)) {
      return NextResponse.json({ ok: true });
    }

    const body = await req.json();
    const event = body?.event;
    const data = body?.data;

    // ── Processa mensagens de membros nos grupos VIP e Elite ──────────────
    if (event === "messages.upsert" && data?.key?.remoteJid && !data?.key?.fromMe) {
      const groupJid = data.key.remoteJid;
      const plano = GRUPOS_BOT[groupJid];

      // Só responde em VIP e Elite, e só para mensagens de texto com conteúdo relevante
      if (plano && data.message?.conversation) {
        const texto = data.message.conversation as string;

        if (deveBotResponder(texto) && texto.length > 10) {
          // Enfileira para o bot-responder processar. usuario_id é NULL (mensagem de
          // grupo não tem dono identificado de forma confiável) — usuario_id=0 violava
          // a FK para usuarios(id) e fazia todo INSERT falhar silenciosamente (.catch),
          // então o bot nunca respondia nada.
          await sql`
            INSERT INTO whatsapp_fila (usuario_id, tipo, mensagem, agendado_para)
            VALUES (NULL, ${`pergunta_${plano}`}, ${texto.slice(0, 500)}, NOW() + INTERVAL '30 seconds')
          `.catch(() => {});
        }
      }
      return NextResponse.json({ ok: true });
    }

    // ── Processa entrada de novos membros ─────────────────────────────────
    if (event !== "group-participants-update") {
      return NextResponse.json({ ok: true });
    }

    const { groupJid, participants, action } = data || {};

    // Só processa quando alguém entra no grupo
    if (action !== "add" || !groupJid || !participants?.length) {
      return NextResponse.json({ ok: true });
    }

    const plano = await getPlanoByGroupId(groupJid);
    if (!plano) return NextResponse.json({ ok: true });

    for (const participantJid of participants) {
      const telefone = participantJid.replace("@s.whatsapp.net", "").replace("@c.us", "");
      const usuario = await getUsuarioByTelefone(telefone);

      const nome = usuario?.nome || "Patriota";

      // Posta boas-vindas no grupo — FASE 24: o retorno do envio não era checado e o log
      // abaixo gravava 'sucesso' incondicionalmente, mascarando falha real da Evolution API
      // (mesma classe de bug já corrigida em outros 8+ pontos nas Fases 17/22/23/24).
      const msg = buildBoasVindasGrupo(plano, nome);
      const enviado = msg ? await enviarMensagemGrupo(plano, msg) : true;

      // Registra no banco se usuário encontrado
      if (usuario) {
        const grupoRows = await sql`SELECT id FROM grupos_whatsapp WHERE plano = ${plano} LIMIT 1`;
        if (grupoRows.length > 0) {
          await sql`
            INSERT INTO membros_grupos (usuario_id, grupo_id, status)
            VALUES (${usuario.id}, ${grupoRows[0].id}, 'ativo')
            ON CONFLICT (usuario_id, grupo_id) DO UPDATE SET status = 'ativo', data_saida = NULL
          `.catch(() => {});
        }
      }

      // Log do agente
      await sql`
        INSERT INTO agentes_log (agente, acao, status, detalhes)
        VALUES ('regina-recepcao', 'boas_vindas_grupo', ${enviado ? "sucesso" : "erro"}, ${JSON.stringify({ telefone, plano, nome })})
      `.catch(() => {});
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("webhook/whatsapp error:", err);
    return NextResponse.json({ ok: true });
  }
}
