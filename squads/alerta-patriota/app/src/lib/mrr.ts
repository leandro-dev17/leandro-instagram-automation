/**
 * Fonte única de cálculo de MRR (Monthly Recurring Revenue).
 *
 * FASE 27.3: antes desta função, 5 lugares diferentes calculavam MRR de formas
 * divergentes — alguns com preço hardcoded por plano (desatualiza quando o preço
 * muda), alguns contando `usuarios` em vez de `assinaturas` (não diferencia ciclo
 * mensal/anual), alguns ignorando assinaturas anuais por completo. A fórmula correta
 * (usada por fiscal-mrr e admin/financeiro antes desta refatoração) é: somar o
 * `valor` REAL de cada assinatura ativa, normalizando anual para mensal (valor/12).
 */
import { sql } from "@/lib/db";

export type MrrPorPlano = Record<string, { assinantes: number; mrr: number }>;

export interface MrrResultado {
  porPlano: MrrPorPlano;
  mrrTotal: number;
  totalAssinantes: number;
}

export async function calcularMRR(): Promise<MrrResultado> {
  const rows = await sql`
    SELECT plano, COUNT(*) as total,
           SUM(CASE WHEN ciclo = 'anual' THEN valor / 12.0 ELSE valor END) as soma
    FROM assinaturas
    WHERE status = 'ativa'
    GROUP BY plano
  `;

  const porPlano: MrrPorPlano = {};
  for (const row of rows) {
    const plano = String(row.plano);
    porPlano[plano] = { assinantes: Number(row.total), mrr: Number(row.soma) };
  }

  const mrrTotal = Object.values(porPlano).reduce((acc, v) => acc + v.mrr, 0);
  const totalAssinantes = Object.values(porPlano).reduce((acc, v) => acc + v.assinantes, 0);

  return { porPlano, mrrTotal, totalAssinantes };
}
