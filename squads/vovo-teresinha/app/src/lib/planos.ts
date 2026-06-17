export const PLANOS = {
  mensal:     { titulo: "Receitinhas Premium - Mensal",     valor: 9.9,  frequencia: 1,  freeTrialDias: 0, mpPlanId: "727b2e6dc3dd41bdbbe91e4d40b90f59" },
  trimestral: { titulo: "Receitinhas Premium - Trimestral", valor: 29.9, frequencia: 3,  freeTrialDias: 7, mpPlanId: "82630eb1950d4d3d88cc0b9716f5bc03" },
  anual:      { titulo: "Receitinhas Premium - Anual",      valor: 79.9, frequencia: 12, freeTrialDias: 7, mpPlanId: "c860bf2b5e7a41a09c4cc100ac5e79f0" },
} as const;

export type PlanoId = keyof typeof PLANOS;
