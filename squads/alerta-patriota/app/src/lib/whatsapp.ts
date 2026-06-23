import type { Plano } from "@/lib/db";
import { alertarTelegram } from "@/lib/telegram";

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

// FASE 21: antes, qualquer falha (rede ou HTTP) era engolida silenciosamente (`catch { return false }`),
// sem retry e sem alerta — cliente pagava e não entrava no grupo, ou perguntava e nunca recebia
// resposta, sem que ninguém soubesse. Agora tenta de novo uma vez e, se persistir, alerta no Telegram.
async function chamarEvolution(url: string, options: RequestInit, contexto: string, tentativas = 2): Promise<boolean> {
  let ultimoErro: unknown = null;
  for (let i = 1; i <= tentativas; i++) {
    try {
      const res = await fetch(url, options);
      if (res.ok) return true;
      ultimoErro = `HTTP ${res.status}`;
    } catch (e) {
      ultimoErro = e;
    }
    if (i < tentativas) await new Promise((r) => setTimeout(r, 1500));
  }
  await alertarTelegram("🔴", `Evolution API falhou — ${contexto}`, `Após ${tentativas} tentativas: ${String(ultimoErro)}`).catch(() => {});
  return false;
}

export async function enviarMensagemPrivada(telefone: string, texto: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY) return false;
  const numero = telefone.replace(/\D/g, "");
  if (!numero || numero.length < 10) return false;

  return chamarEvolution(`${EVO_URL}/message/sendText/${EVO_INST_VIP}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({
      number: `${numero}@s.whatsapp.net`,
      text: texto,
    }),
  }, `enviarMensagemPrivada → ${numero}`);
}

// Defesa contra valores de plano fora de "vip"/"elite" vindos de dados externos (ex: webhook MP)
const GRUPOS_ATIVOS: Plano[] = ["vip", "elite"];

export async function enviarMensagemGrupo(plano: Plano, texto: string): Promise<boolean> {
  if (!GRUPOS_ATIVOS.includes(plano)) return false;
  if (!EVO_URL || !EVO_KEY) return false;
  const groupId = GROUP_IDS[plano];
  if (!groupId) return false;

  return chamarEvolution(`${EVO_URL}/message/sendText/${getInstancia(plano)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({
      number: groupId,
      text: texto,
    }),
  }, `enviarMensagemGrupo → plano ${plano}`);
}

export async function adicionarMembroGrupo(telefone: string, plano: Plano): Promise<boolean> {
  if (!GRUPOS_ATIVOS.includes(plano)) return false;
  if (!EVO_URL || !EVO_KEY) return false;
  const groupId = GROUP_IDS[plano];
  if (!groupId) return false;
  const numero = telefone.replace(/\D/g, "");
  if (!numero) return false;

  return chamarEvolution(`${EVO_URL}/group/updateParticipant/${getInstancia(plano)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({
      groupJid: groupId,
      action: "add",
      participants: [`${numero}@s.whatsapp.net`],
    }),
  }, `adicionarMembroGrupo → ${numero} (${plano})`);
}

export async function removerMembroGrupo(telefone: string, plano: Plano): Promise<boolean> {
  if (!GRUPOS_ATIVOS.includes(plano)) return false;
  if (!EVO_URL || !EVO_KEY) return false;
  const groupId = GROUP_IDS[plano];
  if (!groupId) return false;
  const numero = telefone.replace(/\D/g, "");
  if (!numero) return false;

  return chamarEvolution(`${EVO_URL}/group/updateParticipant/${getInstancia(plano)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({
      groupJid: groupId,
      action: "remove",
      participants: [`${numero}@s.whatsapp.net`],
    }),
  }, `removerMembroGrupo → ${numero} (${plano})`);
}

export async function enviarEnqueteGrupo(plano: Plano, pergunta: string, opcoes: string[]): Promise<boolean> {
  if (!GRUPOS_ATIVOS.includes(plano)) return false;
  if (!EVO_URL || !EVO_KEY) return false;
  const groupId = GROUP_IDS[plano];
  if (!groupId) return false;

  return chamarEvolution(`${EVO_URL}/message/sendPoll/${getInstancia(plano)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", apikey: EVO_KEY },
    body: JSON.stringify({
      number: groupId,
      name: pergunta,
      selectableCount: 1,
      values: opcoes,
    }),
  }, `enviarEnqueteGrupo → plano ${plano}`);
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
