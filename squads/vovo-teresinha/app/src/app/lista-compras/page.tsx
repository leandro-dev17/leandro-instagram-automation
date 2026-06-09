"use client";

import { useEffect, useState } from "react";
import NavBar from "@/components/NavBar";

type Item = {
  id: number;
  item: string;
  checked: boolean;
  receita_id: number | null;
  receita_titulo: string | null;
};

type Grupo = {
  titulo: string | null;
  receita_id: number | null;
  itens: Item[];
};

export default function ListaComprasPage() {
  const [itens, setItens] = useState<Item[]>([]);
  const [novo, setNovo] = useState("");
  const [carregando, setCarregando] = useState(true);

  useEffect(() => {
    carregar();
  }, []);

  function carregar() {
    fetch("/api/lista-compras")
      .then((r) => r.json())
      .then((data) => {
        setItens(data.dados || []);
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    if (!novo.trim()) return;
    const res = await fetch("/api/lista-compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ item: novo.trim() }),
    });
    const data = await res.json();
    if (data.dados) {
      setItens((prev) => [data.dados, ...prev]);
      setNovo("");
    }
  }

  async function toggleCheck(item: Item) {
    await fetch("/api/lista-compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: item.id, checked: !item.checked }),
    });
    setItens((prev) => prev.map((i) => i.id === item.id ? { ...i, checked: !i.checked } : i));
  }

  async function remover(id: number) {
    await fetch("/api/lista-compras", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    setItens((prev) => prev.filter((i) => i.id !== id));
  }

  async function removerGrupo(receitaId: number) {
    await fetch("/api/lista-compras", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ receita_id: receitaId }),
    });
    setItens((prev) => prev.filter((i) => i.receita_id !== receitaId));
  }

  async function limparMarcados() {
    await fetch("/api/lista-compras", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setItens((prev) => prev.filter((i) => !i.checked));
  }

  // Group items by recipe
  const naoConcluidos = itens.filter((i) => !i.checked);
  const concluidos = itens.filter((i) => i.checked);

  const grupos: Grupo[] = [];
  const seen = new Set<string>();
  for (const item of naoConcluidos) {
    const key = item.receita_titulo || "__avulso";
    if (!seen.has(key)) {
      seen.add(key);
      grupos.push({ titulo: item.receita_titulo, receita_id: item.receita_id, itens: [] });
    }
    grupos[grupos.length - 1 < 0 ? 0 : grupos.findIndex((g) => (g.titulo || "__avulso") === key)].itens.push(item);
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="text-xl font-bold flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
            🛒 Lista de Compras
          </h1>
          {concluidos.length > 0 && (
            <button onClick={limparMarcados} className="text-xs font-medium" style={{ color: "var(--vovo-rosa)" }}>
              Limpar marcados
            </button>
          )}
        </div>

        <form onSubmit={adicionar} className="flex gap-2 mb-4">
          <input
            type="text"
            value={novo}
            onChange={(e) => setNovo(e.target.value)}
            placeholder="Adicionar item..."
            className="input-field flex-1"
          />
          <button type="submit" className="btn-primary px-4">+</button>
        </form>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">🛒</div></div>
        ) : itens.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">📋</div>
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
              Lista vazia. Adicione itens ou vá a uma receita e clique em &quot;Adicionar à lista&quot;!
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {grupos.map((grupo) => (
              <div key={grupo.titulo || "avulso"}>
                {grupo.titulo ? (
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-sm font-bold" style={{ color: "var(--vovo-marrom)" }}>
                      🍳 {grupo.titulo}
                    </p>
                    <button
                      onClick={() => grupo.receita_id && removerGrupo(grupo.receita_id)}
                      className="text-xs"
                      style={{ color: "var(--vovo-lock)" }}
                    >
                      Remover todos
                    </button>
                  </div>
                ) : (
                  <p className="text-xs font-medium mb-2" style={{ color: "var(--vovo-lock)" }}>Itens avulsos</p>
                )}
                <div className="space-y-2">
                  {grupo.itens.map((item) => (
                    <div key={item.id} className="card flex items-center gap-3 p-3">
                      <button onClick={() => toggleCheck(item)} className="text-xl flex-shrink-0">
                        ⬜
                      </button>
                      <span className="flex-1 text-sm" style={{ color: "var(--vovo-marrom)" }}>{item.item}</span>
                      <button onClick={() => remover(item.id)} className="text-xs opacity-40 hover:opacity-100">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            ))}

            {concluidos.length > 0 && (
              <div>
                <p className="text-xs font-medium mb-2" style={{ color: "var(--vovo-lock)" }}>
                  ✅ Marcados ({concluidos.length})
                </p>
                <div className="space-y-2">
                  {concluidos.map((item) => (
                    <div key={item.id} className="card flex items-center gap-3 p-3 opacity-60">
                      <button onClick={() => toggleCheck(item)} className="text-xl flex-shrink-0">✅</button>
                      <span className="flex-1 text-sm line-through" style={{ color: "var(--vovo-lock)" }}>{item.item}</span>
                      <button onClick={() => remover(item.id)} className="text-xs opacity-40 hover:opacity-100">✕</button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
