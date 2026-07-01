import { sql } from "@/lib/db";

const EVO_URL = process.env.EVOLUTION_API_URL;
const EVO_KEY = process.env.EVOLUTION_API_KEY;
const EVO_INST = process.env.EVOLUTION_INSTANCIA;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";
const GRUPO_WPP = process.env.WHATSAPP_GROUP_LINK || "";

export async function enviarViaEvolution(telefone: string, texto: string): Promise<boolean> {
  if (!EVO_URL || !EVO_KEY || !EVO_INST) return false;
  const numero = telefone.replace(/\D/g, "");
  if (!numero || numero.length < 10) return false;

  try {
    const res = await fetch(`${EVO_URL}/message/sendText/${EVO_INST}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", apikey: EVO_KEY },
      body: JSON.stringify({
        number: numero,
        text: texto,
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function enfileirarMensagem(usuarioId: number, tipo: string, extra?: string) {
  await sql`
    INSERT INTO whatsapp_fila (usuario_id, tipo, mensagem, agendado_para)
    VALUES (${usuarioId}, ${tipo}, ${extra ?? tipo}, NOW())
    ON CONFLICT DO NOTHING
  `.catch(() => {});
}

export function buildMensagem(tipo: string, nome: string, sexo: "M" | "F" = "F", extra?: string): string {
  const bemVindo = sexo === "M" ? "Bem-vindo" : "Bem-vinda";
  const aluno = sexo === "M" ? "aluno" : "aluna";

  switch (tipo) {
    case "boas_vindas_livro":
      return (
        `🎉 *Parabéns! Sua assinatura do Livro de Receitas foi ativada!*\n\n` +
        `Olá ${nome}! A Vovó Teresinha ficou tão feliz! 👵❤️\n\n` +
        `Você tem acesso a mais de 400 receitinhas, plano semanal automático, geladeira inteligente e lista de compras integrada!\n\n` +
        `👉 ${APP_URL}/receitas\n\n` +
        `Com carinho, Vovó Teresinha 🌸`
      );

    case "boas_vindas_caderninho":
      return (
        `🎉 *Parabéns! Seu Caderninho foi ativado!*\n\n` +
        `Olá ${nome}! A Vovó Teresinha ficou tão feliz! 👵❤️\n\n` +
        `Você já tem acesso às 80 receitinhas selecionadas pela Vovó, com novidades toda semana!\n\n` +
        `👉 ${APP_URL}/receitas\n\n` +
        `Com carinho, Vovó Teresinha 🌸`
      );

    case "boas_vindas_trial":
      return (
        `🎁 *Seus 7 dias grátis começaram!*\n\n` +
        `Olá ${nome}! A Vovó está animada com você por aqui! 👵\n\n` +
        `Durante 7 dias você tem acesso completo a todas as receitas premium. Aproveite cada receitinha!\n\n` +
        `👉 ${APP_URL}/receitas\n\n` +
        `Com carinho, Vovó Teresinha 🌸`
      );

    case "boas_vindas_app":
      return (
        `🌸 *${bemVindo} às Receitinhas da Vovó!*\n\n` +
        `Olá ${nome}! A Vovó Teresinha está tão feliz que você chegou! 👵❤️\n\n` +
        `Aqui você encontra centenas de receitinhas deliciosas e saudáveis feitas com todo carinho.\n\n` +
        (GRUPO_WPP ? `Entre também no nosso grupinho! 👇\n${GRUPO_WPP}\n\n` : "") +
        `Com carinho, Vovó Teresinha 🌸`
      );

    case "boas_vindas_aluna":
      return (
        `🏋️ *${bemVindo}, ${aluno} do Personal Leandro!*\n\n` +
        `Olá ${nome}! A Vovó ficou tão feliz quando o personal favorito dela me contou que você ia vir! 👵💪\n\n` +
        `Você já tem acesso COMPLETO a todas as receitas, inclusive a área exclusiva do Personal Leandro. É presente dele pra você! 🎁\n\n` +
        `👉 ${APP_URL}/receitas\n\n` +
        `Com carinho, Vovó Teresinha 🌸`
      );

    case "trial_expirando_3":
      return (
        `⏰ *Seu teste grátis expira em 3 dias!*\n\n` +
        `Olá ${nome}! A Vovó fica triste de te ver ir embora... 😢\n\n` +
        `Não perca o acesso às suas receitinhas! Venha fazer parte:\n` +
        `📒 Caderninho: R$9,90/mês (80 receitas)\n` +
        `📖 Livro de Receitas: R$19,90/mês (400+ receitas)\n\n` +
        `👉 ${APP_URL}/assinar\n\n` +
        `Com carinho, Vovó Teresinha 🌸`
      );

    case "trial_expirando_1":
      return (
        `⚠️ *Último dia do seu teste grátis!*\n\n` +
        `Olá ${nome}! Hoje é o último dia do seu acesso premium gratuito!\n\n` +
        `A Vovó não quer que você fique sem suas receitinhas! Venha fazer parte:\n` +
        `📒 Caderninho: R$9,90/mês\n` +
        `📖 Livro de Receitas: R$19,90/mês\n\n` +
        `👉 ${APP_URL}/assinar\n\n` +
        `Com carinho, Vovó Teresinha 🌸`
      );

    case "saudade_vovo":
      return (
        `Oi ${nome}, meu amor! 👵💛\n\n` +
        `A vovó está sentindo a sua falta... notei que você não vem mais ver minhas receitinhas.\n\n` +
        `Salvei umas receitinhas novas especialmente pensando em você! Vem ver agora? 🍲✨\n\n` +
        `👉 ${APP_URL}/receitas\n\n` +
        `A vovó ama você! 🌸`
      );

    case "novidades_semana":
      return (
        `🍲 *Novidades da Vovó Teresinha!*\n\n` +
        `${extra}\n\n` +
        `Acesse o app e confira! 💜\n\n` +
        `👉 ${APP_URL}/receitas`
      );

    case "convite_fim_de_semana":
      return (
        `Oi ${nome}, meu amor! 👵🌸\n\n` +
        `Chegou a sextou e a vovó já deixou tudo prontinho pra você! Tem receitinhas novas esperando por aqui.\n\n` +
        (extra
          ? `Que tal preparar *${extra}* hoje à noite? A vovó garante que vai ficar uma delícia! 🍲✨\n\n`
          : `Dá uma espiadinha nas novidades! 🍲✨\n\n`) +
        `Aproveita pra já ver as receitinhas e se programar pro fim de semana também, viu?\n\n` +
        `👉 ${APP_URL}/receitas\n\n` +
        `Bjos da vovó, e um ótimo fim de semana! 🌸`
      );

    default:
      return tipo;
  }
}
