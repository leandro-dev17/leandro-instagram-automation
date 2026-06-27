import { redirect } from "next/navigation";

// FASE 27.6: este redirect descartava TODOS os query params (plano, ciclo, cupom, utm_source) —
// usados por sequencia-nao-conversao, engajamento, brevo.ts e o card de notícias para levar o
// usuário direto a um plano/ciclo específico (e, em campanhas de win-back, um cupom de desconto).
// Encaminha a query string para "/" em vez de jogá-la fora.
export default async function AssinarPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const qs = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (typeof valor === "string") qs.set(chave, valor);
  }
  const suffix = qs.toString();
  redirect(suffix ? `/?${suffix}` : "/");
}
