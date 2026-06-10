import { sql } from "@/lib/db";
import { enfileirarMensagem } from "@/lib/whatsapp";

const COOLDOWN_DIAS_PADRAO = 14;

/**
 * Enfileira a mensagem "saudade_vovo" para um usuário, respeitando um
 * cooldown por usuário (evita reenviar a mesma cobrança várias vezes
 * em poucos dias quando agentes diferentes detectam a mesma inatividade).
 * Retorna true se a mensagem foi enfileirada agora, false se está em cooldown.
 */
export async function enviarSaudadeVovo(
  usuarioId: number,
  cooldownDias: number = COOLDOWN_DIAS_PADRAO
): Promise<boolean> {
  const chave = `saudade_vovo_${usuarioId}`;

  const existente = await sql`
    SELECT valor FROM app_configuracoes WHERE chave = ${chave}
  ` as { valor: string }[];

  if (existente.length > 0) {
    const ultimoEnvio = new Date(existente[0].valor).getTime();
    const diasPassados = (Date.now() - ultimoEnvio) / (1000 * 60 * 60 * 24);
    if (diasPassados < cooldownDias) return false;
  }

  const agora = new Date().toISOString();
  await sql`
    INSERT INTO app_configuracoes (chave, valor) VALUES (${chave}, ${agora})
    ON CONFLICT (chave) DO UPDATE SET valor = ${agora}
  `;

  await enfileirarMensagem(usuarioId, "saudade_vovo");
  return true;
}
