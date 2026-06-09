"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

type Favorito = {
  id: number;
  receita_id: number;
  titulo: string;
  descricao: string;
  categoria: string;
  foto_url: string | null;
  tempo_preparo: number;
  is_premium: boolean;
  is_free_rotativa: boolean;
  tags_restricao: string[];
};

function optimizeUrl(url: string, width: number): string {
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/w_${width},f_auto,q_auto,c_fill/`);
  }
  return url;
}

export default function FavoritosPage() {
  const [favoritos, setFavoritos] = useState<Favorito[]>([]);
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch("/api/usuarios/favoritos")
      .then((r) => r.json())
      .then((data) => {
        setFavoritos(data.dados || []);
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }, []);

  async function removerFavorito(receitaId: number) {
    await fetch("/api/usuarios/favoritos", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receita_id: receitaId }),
    });
    setFavoritos((prev) => prev.filter((f) => f.receita_id !== receitaId));
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-4 flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
          ❤️ Minhas Favoritas
        </h1>

        {carregando ? (
          <div className="text-center py-12">
            <div className="text-4xl animate-bounce">🍳</div>
          </div>
        ) : favoritos.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">🤍</div>
            <p className="font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>
              Nenhuma receita favorita ainda
            </p>
            <p className="text-sm mb-4" style={{ color: "var(--vovo-marrom-mid)" }}>
              Explore as receitas e clique no coração para salvar!
            </p>
            <Link href="/receitas" className="btn-primary">
              Ver receitas
            </Link>
          </div>
        ) : (
          <div className="space-y-3">
            {favoritos.map((f) => (
              <div key={f.id} className="card flex items-center gap-3 p-3">
                <Link href={`/receitas/${f.receita_id}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="w-16 h-16 rounded-xl flex-shrink-0 relative overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#f5f0ea" }}>
                    {f.foto_url ? (
                      <img
                        src={optimizeUrl(f.foto_url, 120)}
                        alt={f.titulo}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-2xl">🍽️</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <h3 className="text-sm font-semibold truncate" style={{ color: "var(--vovo-marrom)" }}>
                      {f.titulo}
                    </h3>
                    <p className="text-xs mt-0.5" style={{ color: "var(--vovo-lock)" }}>
                      ⏱ {f.tempo_preparo}min
                    </p>
                  </div>
                </Link>
                <button
                  onClick={() => removerFavorito(f.receita_id)}
                  className="text-xl flex-shrink-0"
                >
                  ❤️
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
