import { MetadataRoute } from "next";
import { sql } from "@/lib/db";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://receitinhas-vovo-teresinha.vercel.app";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const rotas: MetadataRoute.Sitemap = [
    { url: APP_URL, lastModified: new Date(), changeFrequency: "daily", priority: 1 },
    { url: `${APP_URL}/receitas`, lastModified: new Date(), changeFrequency: "daily", priority: 0.9 },
    { url: `${APP_URL}/assinar`, lastModified: new Date(), changeFrequency: "weekly", priority: 0.8 },
    { url: `${APP_URL}/login`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
    { url: `${APP_URL}/cadastro`, lastModified: new Date(), changeFrequency: "monthly", priority: 0.5 },
  ];

  try {
    // Apenas receitas públicas (free ou free_rotativa)
    const receitas = await sql`
      SELECT id, titulo, updated_at
      FROM receitas
      WHERE ativo = true AND (is_premium = false OR is_free_rotativa = true)
      ORDER BY id DESC
      LIMIT 500
    `;

    for (const r of receitas) {
      rotas.push({
        url: `${APP_URL}/receitas/${r.id}`,
        lastModified: r.updated_at ? new Date(r.updated_at) : new Date(),
        changeFrequency: "monthly",
        priority: 0.7,
      });
    }
  } catch {
    // Se o banco falhar, retorna só as rotas estáticas
  }

  return rotas;
}
