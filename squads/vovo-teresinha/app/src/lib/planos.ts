export const PLANOS = {
  caderninho:    { titulo: "Caderninho de Receitas",  valor: 9.9,  frequencia: 1, freeTrialDias: 0, mpPlanId: "9b0ebe550ddc4a72851880c7eb346029" },
  livro_receitas: { titulo: "Livro de Receitas",      valor: 19.9, frequencia: 1, freeTrialDias: 7, mpPlanId: "9ef63b922053496b8b1418988f290589" },
} as const;

export type PlanoId = keyof typeof PLANOS;
