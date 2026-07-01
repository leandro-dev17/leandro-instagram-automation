"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";
import ModoPreparo from "@/components/ModoPreparo";

type Receita = {
  id: number;
  titulo: string;
  descricao: string;
  categoria: string;
  tags_restricao: string[];
  ingredientes: string;
  modo_preparo: string;
  tempo_preparo: number;
  calorias: number | null;
  proteina: number | null;
  carboidratos: number | null;
  gordura: number | null;
  fibras: number | null;
  dica_vovo: string | null;
  dica_vovo_truncada?: boolean;
  porcoes: number;
  foto_url: string | null;
  is_premium: boolean;
  is_free_rotativa: boolean;
  avaliacao_media?: number;
  avaliacao_count?: number;
  locked?: boolean;
};

function optimizeUrl(url: string, width: number): string {
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/w_${width},f_auto,q_auto,c_fill/`);
  }
  return url;
}

export default function ReceitaDetalhe() {
  const params = useParams();
  const router = useRouter();
  const id = params.id as string;

  const [receita, setReceita] = useState<Receita | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [favorito, setFavorito] = useState(false);
  const [adicionando, setAdicionando] = useState(false);
  const [adicionandoLista, setAdicionandoLista] = useState(false);
  const [listaOk, setListaOk] = useState(false);
  const [erroFavorito, setErroFavorito] = useState("");
  const [compartilhado, setCompartilhado] = useState(false);
  const [minhaNota, setMinhaNota] = useState<number | null>(null);
  const [mediaAvaliacao, setMediaAvaliacao] = useState(0);
  const [totalAvaliacoes, setTotalAvaliacoes] = useState(0);
  const [avaliando, setAvaliando] = useState(false);
  const [modoPreparo, setModoPreparo] = useState(false);

  useEffect(() => {
    fetch(`/api/receitas/${id}`)
      .then((r) => r.json())
      .then((data) => {
        setReceita(data.dados);
        setCarregando(false);
      })
      .catch(() => setCarregando(false));

    fetch("/api/usuarios/favoritos")
      .then((r) => r.json())
      .then((data) => {
        if (data.dados) {
          setFavorito(data.dados.some((f: { receita_id: number }) => f.receita_id === parseInt(id)));
        }
      });

    fetch(`/api/receitas/${id}/avaliar`)
      .then((r) => r.json())
      .then((d) => {
        setMinhaNota(d.minha_nota);
        setMediaAvaliacao(d.media || 0);
        setTotalAvaliacoes(d.total || 0);
      })
      .catch(() => {});
  }, [id]);

  async function toggleFavorito() {
    if (adicionando) return;
    setAdicionando(true);
    setErroFavorito("");

    if (favorito) {
      await fetch("/api/usuarios/favoritos", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receita_id: parseInt(id) }),
      });
      setFavorito(false);
    } else {
      const res = await fetch("/api/usuarios/favoritos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ receita_id: parseInt(id) }),
      });
      if (res.ok) {
        setFavorito(true);
      } else {
        const data = await res.json();
        setErroFavorito(data.erro || "Não foi possível favoritar.");
      }
    }

    setAdicionando(false);
  }

  async function avaliar(nota: number) {
    if (avaliando) return;
    setAvaliando(true);
    setMinhaNota(nota);
    try {
      const res = await fetch(`/api/receitas/${id}/avaliar`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ nota }),
      });
      const data = await res.json();
      if (res.ok) {
        setMediaAvaliacao(data.media);
        setTotalAvaliacoes(data.total);
      }
    } catch {
      // silently fail
    } finally {
      setAvaliando(false);
    }
  }

  async function compartilhar() {
    const url = `${window.location.origin}/receitas/${id}`;
    const texto = `🍳 ${receita?.titulo} — Receita da Vovó Teresinha!\n\n${receita?.descricao}\n\nVer receita completa: ${url}`;
    if (navigator.share) {
      await navigator.share({ title: receita?.titulo, text: texto, url });
    } else {
      await navigator.clipboard.writeText(url);
      setCompartilhado(true);
      setTimeout(() => setCompartilhado(false), 2000);
    }
  }

  async function adicionarNaLista() {
    if (!receita || adicionandoLista) return;
    setAdicionandoLista(true);

    const ingredientesArray = (typeof receita.ingredientes === "string" ? receita.ingredientes : "")
      .split("\n")
      .filter((i) => i.trim())
      .map((i) => i.trim().replace(/^•\s*/, ""));

    await fetch("/api/lista-compras", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        itens: ingredientesArray,
        receita_id: parseInt(id),
        receita_titulo: receita.titulo,
      }),
    });

    setAdicionandoLista(false);
    setListaOk(true);
    setTimeout(() => setListaOk(false), 2500);
  }

  if (carregando) {
    return (
      <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
        <NavBar />
        <div className="flex items-center justify-center py-20">
          <div className="text-4xl animate-bounce">🍳</div>
        </div>
      </div>
    );
  }

  if (!receita) {
    return (
      <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
        <NavBar />
        <div className="text-center py-20">
          <p style={{ color: "var(--vovo-marrom-mid)" }}>Receita não encontrada</p>
          <button onClick={() => router.back()} className="btn-primary mt-4">Voltar</button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      {modoPreparo && receita && !receita.locked && (
        <ModoPreparo
          titulo={receita.titulo}
          modoPreparo={receita.modo_preparo}
          onClose={() => setModoPreparo(false)}
        />
      )}
      <NavBar />

      <div className="max-w-2xl mx-auto">
        <div className="h-48 relative overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#f5f0ea" }}>
          {receita.foto_url ? (
            <img
              src={optimizeUrl(receita.foto_url, 800)}
              alt={receita.titulo}
              loading="eager"
              decoding="async"
              className="absolute inset-0 w-full h-full object-cover"
            />
          ) : (
            <span className="text-6xl">🍽️</span>
          )}
          <button
            onClick={() => router.back()}
            className="absolute top-3 left-3 bg-white bg-opacity-90 rounded-full p-2 text-lg shadow"
          >
            ←
          </button>
        </div>

        <div className="px-4 py-4">
          <div className="flex items-start justify-between gap-2 mb-3">
            <h1 className="text-xl font-bold flex-1" style={{ color: "var(--vovo-marrom)" }}>
              {receita.titulo}
            </h1>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button
                onClick={compartilhar}
                className="text-xl transition-transform hover:scale-110"
                title="Compartilhar"
              >
                {compartilhado ? "✅" : "📤"}
              </button>
              <button
                onClick={toggleFavorito}
                className="text-2xl transition-transform hover:scale-110"
                disabled={adicionando}
              >
                {favorito ? "❤️" : "🤍"}
              </button>
            </div>
          </div>

          {erroFavorito && (
            <div className="mb-3 px-3 py-2 rounded-xl text-xs text-center" style={{ backgroundColor: "#fef3cd", color: "#856404" }}>
              {erroFavorito}{" "}
              <Link href="/assinar" style={{ color: "var(--vovo-rosa)", fontWeight: 600 }}>
                Ver planos
              </Link>
            </div>
          )}

          <p className="text-sm mb-3" style={{ color: "var(--vovo-marrom-mid)" }}>
            {receita.descricao}
          </p>

          <div className="flex gap-4 mb-4 flex-wrap">
            <div className="text-center">
              <div className="text-lg">⏱</div>
              <div className="text-xs font-medium" style={{ color: "var(--vovo-marrom)" }}>{receita.tempo_preparo}min</div>
              <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Tempo</div>
            </div>
            <div className="text-center">
              <div className="text-lg">👥</div>
              <div className="text-xs font-medium" style={{ color: "var(--vovo-marrom)" }}>{receita.porcoes}</div>
              <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Porções</div>
            </div>
            {receita.calorias && (
              <div className="text-center">
                <div className="text-lg">🔥</div>
                <div className="text-xs font-medium" style={{ color: "var(--vovo-marrom)" }}>{receita.calorias}</div>
                <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>Kcal/porção</div>
              </div>
            )}
          </div>

          {/* Rating stars */}
          <div className="flex items-center gap-3 mb-4">
            <div className="flex items-center gap-0.5">
              {[1, 2, 3, 4, 5].map((estrela) => (
                <button
                  key={estrela}
                  onClick={() => avaliar(estrela)}
                  disabled={avaliando}
                  className="text-2xl transition-transform hover:scale-110"
                >
                  {estrela <= (minhaNota ?? 0) ? "⭐" : "☆"}
                </button>
              ))}
            </div>
            {totalAvaliacoes > 0 && (
              <span className="text-xs" style={{ color: "var(--vovo-lock)" }}>
                {mediaAvaliacao.toFixed(1)} ({totalAvaliacoes} {totalAvaliacoes === 1 ? "avaliação" : "avaliações"})
              </span>
            )}
          </div>

          {receita.tags_restricao && receita.tags_restricao.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-4">
              {receita.tags_restricao.map((tag) => (
                <span
                  key={tag}
                  className="text-xs px-2 py-0.5 rounded-full"
                  style={{ backgroundColor: "#e8f5e9", color: "var(--vovo-verde)" }}
                >
                  {tag.replace(/_/g, " ")}
                </span>
              ))}
            </div>
          )}

          {receita.locked ? (
            <div
              className="rounded-xl p-6 text-center my-6"
              style={{ backgroundColor: "white", border: "2px dashed var(--vovo-lock)" }}
            >
              <div className="text-4xl mb-3">🔒</div>
              <h3 className="font-bold mb-2" style={{ color: "var(--vovo-marrom)" }}>
                Receita exclusiva do Livro de Receitas
              </h3>
              <p className="text-sm mb-4" style={{ color: "var(--vovo-marrom-mid)" }}>
                Essa receita não está nas 80 do Caderninho. Assine o Livro de Receitas completo por R$19,90/mês para desbloquear!
              </p>
              <Link href="/assinar" className="btn-primary">
                Ver planos 💕
              </Link>
            </div>
          ) : (
            <>
              <div className="card mb-4">
                <h2 className="font-bold mb-3 flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
                  🛒 Ingredientes
                </h2>
                <pre className="text-sm whitespace-pre-wrap" style={{ color: "var(--vovo-marrom-mid)", fontFamily: "inherit" }}>
                  {receita.ingredientes}
                </pre>
                <button
                  onClick={adicionarNaLista}
                  disabled={adicionandoLista || listaOk}
                  className="mt-3 text-xs font-medium px-3 py-1.5 rounded-lg transition-colors"
                  style={{
                    backgroundColor: listaOk ? "#e8f5e9" : "#f0ebe5",
                    color: listaOk ? "var(--vovo-verde)" : "var(--vovo-marrom)",
                  }}
                >
                  {adicionandoLista ? "Adicionando..." : listaOk ? "✅ Adicionado à lista!" : "📋 Adicionar à lista de compras"}
                </button>
              </div>

              <div className="card mb-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="font-bold flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
                    👩‍🍳 Modo de Preparo
                  </h2>
                  <button
                    onClick={() => setModoPreparo(true)}
                    className="text-xs font-semibold px-3 py-1.5 rounded-xl transition-all active:scale-95"
                    style={{ backgroundColor: "var(--vovo-marrom)", color: "white" }}
                  >
                    ▶ Cozinhar
                  </button>
                </div>
                <pre className="text-sm whitespace-pre-wrap" style={{ color: "var(--vovo-marrom-mid)", fontFamily: "inherit" }}>
                  {receita.modo_preparo}
                </pre>
              </div>

              {/* Info nutricional — premium gate */}
              {(receita.proteina || receita.carboidratos || receita.gordura) ? (
                <div className="card mb-4">
                  <h2 className="font-bold mb-3 flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
                    📊 Info Nutricional <span className="text-xs font-normal px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "#fff3e0", color: "var(--vovo-laranja)" }}>premium</span>
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
                    {[
                      { label: "Proteína", valor: receita.proteina, unit: "g" },
                      { label: "Carbos", valor: receita.carboidratos, unit: "g" },
                      { label: "Gordura", valor: receita.gordura, unit: "g" },
                      { label: "Fibras", valor: receita.fibras, unit: "g" },
                    ].map(({ label, valor, unit }) => (
                      <div key={label}>
                        <div className="text-sm font-bold" style={{ color: "var(--vovo-marrom)" }}>
                          {valor !== null ? `${valor}${unit}` : "—"}
                        </div>
                        <div className="text-xs" style={{ color: "var(--vovo-lock)" }}>{label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : null}

              {/* Dica da Vovó */}
              {receita.dica_vovo && (
                <div
                  className="rounded-xl p-4 mb-4"
                  style={{ backgroundColor: "rgba(200,128,106,0.08)", border: "1.5px solid rgba(200,128,106,0.3)" }}
                >
                  <h2 className="font-bold mb-2 flex items-center gap-2 text-sm" style={{ color: "var(--vovo-rosa)" }}>
                    💌 Dica da Vovó
                  </h2>
                  <p className="text-sm" style={{ color: "var(--vovo-marrom)" }}>
                    &ldquo;{receita.dica_vovo}&rdquo;
                  </p>
                  {receita.dica_vovo_truncada && (
                    <Link href="/assinar" className="text-xs font-semibold mt-2 block" style={{ color: "var(--vovo-rosa)" }}>
                      🔒 Ver dica completa — Seja Premium
                    </Link>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
