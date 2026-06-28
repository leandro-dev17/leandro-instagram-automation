import { sql } from "@/lib/db";

// Cupons de win-back enviados pelo enzo-engajamento (ondas D20/D25/D30) — só Elite Anual.
// Cada código só é válido para quem de fato recebeu aquela onda específica (confere em
// agentes_log pelo usuarioId) e só pode ser usado uma vez por conta — sem isso, qualquer
// pessoa que descobrisse o código (compartilhado, vazado, adivinhado) tinha desconto
// recorrente permanente sem nunca ter sido alvo da campanha de reengajamento.
export const CUPONS: Record<string, { desconto: number; onda: string }> = {
  VOLTA10: { desconto: 0.10, onda: "onda_20" },
  VOLTA15: { desconto: 0.15, onda: "onda_25" },
  VOLTA20: { desconto: 0.20, onda: "onda_30" },
};

export async function validarCupom(
  cupom: string | undefined,
  plano: string,
  usuarioId: number
): Promise<{ desconto: number; codigo: string | null }> {
  if (!cupom || plano !== "elite") return { desconto: 0, codigo: null };

  const codigo = cupom.toUpperCase();
  const config = CUPONS[codigo];
  if (!config) return { desconto: 0, codigo: null };

  const recebeuOnda = await sql`
    SELECT 1 FROM agentes_log
    WHERE agente = 'enzo-engajamento' AND acao = ${config.onda} AND status = 'sucesso'
      AND created_at >= NOW() - INTERVAL '60 days'
      AND (detalhes->>'usuarioId')::int = ${usuarioId}
    LIMIT 1
  `;
  if (recebeuOnda.length === 0) return { desconto: 0, codigo: null };

  // Claim atômico — evita que duplo clique/retry aplique o cupom 2x na corrida.
  const claim = await sql`
    UPDATE usuarios SET cupom_usado = ${codigo}
    WHERE id = ${usuarioId} AND cupom_usado IS NULL
    RETURNING id
  `;
  if (claim.length === 0) return { desconto: 0, codigo: null };

  return { desconto: config.desconto, codigo };
}
