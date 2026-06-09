"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

type Ingrediente = { id: number; ingrediente: string };
type Receita = {
  id: number;
  titulo: string;
  tempo_preparo: number;
  foto_url: string | null;
  calorias: number | null;
  porcentagem_match: number;
};

function optimizeUrl(url: string, width: number): string {
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/w_${width},f_auto,q_auto,c_fill/`);
  }
  return url;
}

export default function GeladeiraPage() {
  const [ingredientes, setIngredientes] = useState<Ingrediente[]>([]);
  const [novo, setNovo] = useState("");
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [mensagem, setMensagem] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    fetch("/api/geladeira")
      .then((r) => r.json())
      .then((data) => {
        setIngredientes(data.dados || []);
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }, []);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;

    const res = await fetch("/api/geladeira", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ingrediente: novo.trim() }),
    });
    const data = await res.json();
    if (data.dados) {
      setIngredientes((prev) => [data.dados, ...prev]);
      setNovo("");
    }
  }

  async function remover(id: number) {
    await fetch("/api/geladeira", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setIngredientes((prev) => prev.filter((i) => i.id !== id));
    setReceitas([]);
  }

  async function buscarReceitas() {
    setBuscando(true);
    setReceitas([]);
    setMensagem("");

    const res = await fetch("/api/geladeira/receitas");
    const data = await res.json();

    setReceitas(data.dados || []);
    setMensagem(data.mensagem || "");
    setBuscando(false);
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-1 flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
          🥦 O que tem na geladeira?
        </h1>
        <p className="text-sm mb-4" style={{ color: "var(--vovo-marrom-mid)" }}>
          Adicione os ingredientes e a Vovó sugere receitas! ✨
        </p>

        <form onSubmit={adicionar} className="flex gap-2 mb-4">
          <input
            type="text"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Frango, brócolis, ovos..."
            className="input-field flex-1"
          />
          <button type="submit" className="btn-primary px-4">
            +
          </button>
        </form>

        {carregando ? (
          <div className="text-center py-8"><div className="text-4xl animate-bounce">🥦</div></div>
        ) : ingredientes.length === 0 ? (
          <div className="text-center py-6" style={{ color: "var(--vovo-marrom-mid)" }}>
            <p className="text-sm">Nenhum ingrediente adicionado ainda 🍽️</p>
          </div>
        ) : (
          <>
            <div className="flex flex-wrap gap-2 mb-4">
              {ingredientes.map((ing) => (
                <span
                  key={ing.id}
                  className="flex items-center gap-1 px-3 py-1.5 rounded-full text-sm font-medium"
                  style={{ backgroundColor: "white", color: "var(--vovo-marrom)", border: "1.5px solid #e5e0da" }}
                >
                  {ing.ingrediente}
                  <button onClick={() => remover(ing.id)} className="ml-1 text-xs opacity-50 hover:opacity-100">✕</button>
                </span>
              ))}
            </div>

            <button onClick={buscarReceitas} disabled={buscando} className="btn-primary w-full mb-6">
              {buscando ? "🤖 Buscando receitas..." : "🔍 Buscar receitas com esses ingredientes"}
            </button>
          </>
        )}

        {mensagem && (
          <div className="text-center py-6" style={{ color: "var(--vovo-marrom-mid)" }}>
            <div className="text-4xl mb-2">😅</div>
            <p className="text-sm">{mensagem}</p>
          </div>
        )}

        {receitas.length > 0 && (
          <div>
            <h2 className="font-bold mb-3" style={{ color: "var(--vovo-marrom)" }}>
              🍳 Receitas sugeridas
            </h2>
            <div className="grid grid-cols-2 gap-3">
              {receitas.map((r) => (
                <Link key={r.id} href={`/receitas/${r.id}`}>
                  <div className="bg-white rounded-xl overflow-hidden shadow-sm">
                    <div className="h-28 relative overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#f5f0ea" }}>
                      {r.foto_url ? (
                        <img
                          src={optimizeUrl(r.foto_url, 300)}
                          alt={r.titulo}
                          loading="lazy"
                          decoding="async"
                          className="absolute inset-0 w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-3xl">🍽️</span>
                      )}
                    </div>
                    <div className="p-2">
                      <h3 className="text-xs font-semibold line-clamp-2" style={{ color: "var(--vovo-marrom)" }}>
                        {r.titulo}
                      </h3>
                      <div className="flex items-center justify-between mt-1">
                        <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>⏱ {r.tempo_preparo}min</p>
                        {r.porcentagem_match > 0 && (
                          <span
                            className="text-xs font-bold px-1.5 py-0.5 rounded-full"
                            style={{
                              backgroundColor: r.porcentagem_match >= 80 ? "#e8f5e9" : "#fff3e0",
                              color: r.porcentagem_match >= 80 ? "var(--vovo-verde)" : "#e67e22",
                            }}
                          >
                            {r.porcentagem_match}%
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
