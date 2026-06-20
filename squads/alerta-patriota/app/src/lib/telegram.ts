const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const CHAT_ID = process.env.TELEGRAM_CHAT_ID;

export async function enviarTelegram(mensagem: string): Promise<boolean> {
  if (!BOT_TOKEN || !CHAT_ID) return false;
  try {
    const res = await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: CHAT_ID, text: mensagem, parse_mode: "HTML" }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function alertarTelegram(nivel: "🟢" | "🟡" | "🔴" | "🚨" | "🤖" | "🔐", titulo: string, detalhes: string): Promise<void> {
  const msg = `${nivel} <b>ALERTA PATRIOTA — ${titulo}</b>\n\n${detalhes}\n\n<i>${new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" })}</i>`;
  await enviarTelegram(msg);
}

export async function relatorioCEO(status: "🟢" | "🟡" | "🔴", conteudo: string): Promise<void> {
  const msg = `👑 <b>GENERAL ALVES — RELATÓRIO DIÁRIO</b>\n${status} ${new Date().toLocaleDateString("pt-BR")}\n\n${conteudo}`;
  await enviarTelegram(msg);
}
