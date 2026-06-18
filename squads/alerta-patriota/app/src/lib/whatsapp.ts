import type { Plano } from "@/lib/db";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST_VIP   = process.env.EVOLUTION_INSTANCIA      || "alertapatriota";
const EVO_INST_ELITE = process.env.EVOLUTION_INSTANCIA_ELITE || "alertapatriota";
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://alertapatriota.vercel.app";

function getInstancia(plano: Plano | string): string {
  return plano === "elite" ? EVO_INST_ELITE : EVO_INST_VIP;
}

// IDs dos grupos por plano
const GROUP_IDS: Record<Plano, string> = {
  vip: process.env.WPP_GROUP_VIP || "",
  elite: process.env.WPP_GROUP_ELITE || "",
};

// Links de convite por plano
const GROUP_LINKS: Record<Plano, string> = {
  vip: process.env.WPP_LINK_VIP || "",
  elite: process.env.WPP_LINK_ELITE || "",
};

// ─── FUNÇÕES BASE ─────────────────────────────────────────────────────────────

export async function enviarMensagemPrivada(telefone: string, texto: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY) return false;
  const numero = telefone.replace(/\D/g, "");
  if (!numero || numero.length < 10) return false;

  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST_VIP}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        number: `${numero}@s.whatsapp.net`,
        textMessage: { text: texto },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Defesa contra valores de plano fora de "vip"/"elite" vindos de dados externos (ex: webhook MP)
const GRUPOS_ATIVOS: Plano[] = ["vip", "elite"];

export async function enviarMensagemGrupo(plano: Plano, texto: string): Promise<boolean> {
  if (!GRUPOS_ATIVOS.includes(plano)) return false;
  if (!EVO_URL || !EVO_KEY) return false;
  const groupId = GROUP_IDS[plano];
  if (!groupId) return false;

  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${getInstancia(plano)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        number: groupId,
        textMessage: { text: texto },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function adicionarMembroGrupo(telefone: string, plano: Plano): Promise<boolean> {
  if (!GRUPOS_ATIVOS.includes(plano)) return false;
  if (!EVO_URL || !EVO_KEY) return false;
  const groupId = GROUP_IDS[plano];
  if (!groupId) return false;
  const numero = telefone.replace(/\D/g, "");
  if (!numero) return false;

  try {
    const res = await fetch(`${EVO_URL}/group/updateParticipant/${getInstancia(plano)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        groupJid: groupId,
        action: "add",
        participants: [`${numero}@s.whatsapp.net`],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function removerMembroGrupo(telefone: string, plano: Plano): Promise<boolean> {
  if (!GRUPOS_ATIVOS.includes(plano)) return false;
  if (!EVO_URL || !EVO_KEY) return false;
  const groupId = GROUP_IDS[plano];
  if (!groupId) return false;
  const numero = telefone.replace(/\D/g, "");
  if (!numero) return false;

  try {
    const res = await fetch(`${EVO_URL}/group/updateParticipant/${getInstancia(plano)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        groupJid: groupId,
        action: "remove",
        participants: [`${numero}@s.whatsapp.net`],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export function getLinkGrupo(plano: Plano): string {
  return GROUP_LINKS[plano] || APP_URL;
}

// ─── MENSAGENS DA PERSONA ──────────────────────────────────────────────────────

export function buildBoasVindas(plano: Plano, nome: string): string {
  const link = getLinkGrupo(plano);

  if (plano === "elite") {
    return (
      `🎖️ *Bem-vindo ao Elite Global, ${nome}.*\n\n` +
      `Sou o Prof. Bernardo Cavalcanti. A partir de agora você recebe análises que a mídia brasileira filtra — direto das fontes que importam: Washington, Buenos Aires, Londres.\n\n` +
      `6 análises por dia. Dossiê semanal em PDF. Zero ruído.\n\n` +
      `Grupo: ${link}\n\n` +
      `_O mundo muda para quem enxerga antes._`
    );
  }

  return (
    `🔥 *${nome}, seja bem-vindo ao VIP Premium!*\n\n` +
    `Aqui é o Capitão Braga. A partir de agora você vai saber o que realmente está acontecendo no Brasil — sem filtro e sem censura.\n\n` +
    `Todo dia, nos horários certos, você recebe as notícias que a mídia grande esconde, com meu comentário direto.\n\n` +
    `📲 Seu grupo: ${link}\n\n` +
    `_Deus, Pátria e Família — sempre._`
  );
}

export function buildBoasVindasGrupo(plano: Plano, nome: string): string {
  if (plano === "elite") {
    return (
      `🎖️ *Bem-vindo, ${nome}.*\n\n` +
      `Prof. Bernardo Cavalcanti aqui. É uma honra ter você conosco no Elite Global.\n\n` +
      `Você está entre os brasileiros que escolheram enxergar o mundo como ele realmente é.\n\n` +
      `_O mundo muda para quem enxerga antes._`
    );
  }

  return (
    `🔥 *${nome}, bem-vindo ao VIP Premium!*\n\n` +
    `Capitão Braga aqui. Você está no grupo mais completo do Alerta Patriota. Notícias, comentários, alertas urgentes quando deputados de direita fazem algo importante — e você pode participar, perguntar, opinar.\n\n` +
    `Fico honrado com sua confiança. Vamo junto! 💪🇧🇷\n\n` +
    `_Deus, Pátria e Família — sempre._`
  );
}

export function buildModosCrise(informacao: string): string {
  return (
    `🚨 *ATUALIZAÇÃO DE CRISE — ${new Date().toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}*\n\n` +
    `${informacao}\n\n` +
    `_Capitão Braga — Alerta Patriota_\n` +
    `_Deus, Pátria e Família — sempre._`
  );
}
