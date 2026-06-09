"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";

type Receita = {
  id: number;
  titulo: string;
  descricao: string;
  categoria: string;
  tags_restricao: string[];
  tempo_preparo: number;
  calorias: number | null;
  foto_url: string | null;
  is_premium: boolean;
  is_free_rotativa: boolean;
};

type ReceitaDestaque = {
  id: number;
  titulo: string;
  descricao: string;
  foto_url: string | null;
  tempo_preparo: number;
  locked: boolean;
};

// índices seguem getDay(): 0=dom, 1=seg, 2=ter, 3=qua, 4=qui, 5=sex, 6=sáb
const BOAS_VINDAS = [
  "Bom domingo! Que tal um almoço especial hoje? 💌",
  "Boa segunda! Que tal começar a semana com uma receita nova? 🍳",
  "Feliz terça! A cozinha da Vovó está pronta para você 💕",
  "Boa quarta! Metade da semana merece uma receita especial 🍽️",
  "Quase sexta! Uma receitinha boa anima o dia 😊",
  "Sexta-feira! Hora de cozinhar algo gostoso 🎉",
  "Bom sábado! Fim de semana pede receita caprichada 🌟",
];

const CATEGORIAS = [
  { value: "", label: "Todas" },
  { value: "cafe_manha", label: "Café da Manhã ☕" },
  { value: "pratos_principais", label: "Pratos Principais 🍽️" },
  { value: "lanches_snacks", label: "Lanches 🥪" },
  { value: "doces_sobremesas", label: "Doces 🍮" },
  { value: "saladas", label: "Saladas 🥗" },
  { value: "sopas_caldos", label: "Sopas 🍲" },
  { value: "sucos_molhos", label: "Sucos & Molhos 🥤" },
  { value: "bolos_tortas", label: "Bolos & Tortas 🎂" },
];

const TAGS = [
  { value: "sem_gluten", label: "Sem Glúten" },
  { value: "sem_lactose", label: "Sem Lactose" },
  { value: "low_carb", label: "Low Carb" },
  { value: "sem_acucar", label: "Sem Açúcar" },
  { value: "vegano", label: "Vegano" },
  { value: "vegetariano", label: "Vegetariano" },
  { value: "proteica", label: "Proteica" },
];

function optimizeUrl(url: string, width: number): string {
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/w_${width},f_auto,q_auto,c_fill/`);
  }
  return url;
}

export default function ReceitasPage() {
  const router = useRouter();
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [premium, setPremium] = useState<boolean | null>(null);
  const [trialFim, setTrialFim] = useState<string | null>(null);
  const [categoria, setCategoria] = useState("");
  const [busca, setBusca] = useState("");
  const [tagsSelecionadas, setTagsSelecionadas] = useState<string[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [pagina, setPagina] = useState(1);
  const [hasMore, setHasMore] = useState(true);
  const [destaque, setDestaque] = useState<ReceitaDestaque | null | undefined>(undefined);
  const boasVindas = BOAS_VINDAS[new Date().getDay()];

  const carregarReceitas = useCallback(async (reset = false) => {
    setCarregando(true);
    const pag = reset ? 1 : pagina;
    const params = new URLSearchParams({ pagina: String(pag), limite: "20" });
    if (categoria) params.set("categoria", categoria);
    if (busca) params.set("busca", busca);
    if (tagsSelecionadas.length > 0) params.set("tags", tagsSelecionadas.join(","));

    try {
      const res = await fetch(`/api/receitas?${params}`);
      const data = await res.json();
      const novas = data.dados || [];
      setPremium(data.premium);
      setTrialFim(data.trial_fim);
      setReceitas(reset ? novas : (prev) => [...prev, ...novas]);
      setHasMore(novas.length === 20);
      if (reset) setPagina(2);
      else setPagina((p) => p + 1);
    } finally {
      setCarregando(false);
    }
  }, [categoria, busca, tagsSelecionadas, pagina]);

  useEffect(() => {
    carregarReceitas(true);
  }, [categoria, tagsSelecionadas]);

  useEffect(() => {
    fetch("/api/receitas/destaque")
      .then((r) => r.json())
      .then((data) => setDestaque(data.dados ?? null))
      .catch(() => setDestaque(null));
  }, []);

  function toggleTag(tag: string) {
    setTagsSelecionadas((prev) =>
      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
    );
  }

  function handleBusca(e: React.FormEvent) {
    e.preventDefault();
    carregarReceitas(true);
  }

  const diasRestantes = trialFim ? Math.ceil((new Date(trialFim).getTime() - Date.now()) / 86400000) : 0;
  const mostrarBannerTrial = !premium && trialFim && diasRestantes <= 2 && diasRestantes > 0;

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />

      <div className="px-4 pt-4 pb-2 max-w-2xl mx-auto">
        {mostrarBannerTrial && (
          <div
            className="rounded-xl p-3 mb-4 flex items-center justify-between text-white text-sm"
            style={{ backgroundColor: "var(--vovo-rosa)" }}
          >
            <span>⏰ Seu trial termina em {diasRestantes} dia{diasRestantes !== 1 ? "s" : ""}!</span>
            <Link href="/assinar" className="bg-white font-bold px-3 py-1 rounded-lg text-xs" style={{ color: "var(--vovo-rosa)" }}>
              Assinar
            </Link>
          </div>
        )}

        {/* Welcome message */}
        <p className="text-sm mb-3" style={{ color: "var(--vovo-marrom-mid)" }}>{boasVindas}</p>

        {/* Receita do Dia */}
        {destaque && (
          <Link href={`/receitas/${destaque.id}`} className="block mb-4">
            <div
              className="rounded-2xl overflow-hidden shadow-md relative"
              style={{ height: 160 }}
            >
              {destaque.foto_url ? (
                <img
                  src={optimizeUrl(destaque.foto_url, 800)}
                  alt={destaque.titulo}
                  loading="eager"
                  decoding="async"
                  className="absolute inset-0 w-full h-full object-cover"
                />
              ) : (
                <div className="absolute inset-0" style={{ backgroundColor: "#c8806a" }} />
              )}
              <div
                className="absolute inset-0"
                style={{ background: "linear-gradient(to top, rgba(0,0,0,0.65) 0%, transparent 55%)" }}
              />
              <div className="absolute bottom-0 left-0 right-0 p-3">
                <div className="flex items-center gap-1 mb-1">
                  <span className="text-xs font-bold text-white bg-white bg-opacity-20 px-2 py-0.5 rounded-full">
                    ⭐ Receita do Dia
                  </span>
                  {destaque.locked && (
                    <span className="text-xs text-white opacity-80">🔒 Premium</span>
                  )}
                </div>
                <h2 className="text-white font-bold text-base leading-tight">{destaque.titulo}</h2>
                <p className="text-white text-xs opacity-80">⏱ {destaque.tempo_preparo}min</p>
              </div>
            </div>
          </Link>
        )}

        {/* Quick access: Geladeira + Lista */}
        <div className="flex gap-2 mb-4">
          <button
            onClick={() => router.push("/geladeira")}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{ backgroundColor: "white", color: "var(--vovo-marrom)", border: "1.5px solid #e5e0da" }}
          >
            🥦 Geladeira
          </button>
          <button
            onClick={() => router.push("/lista-compras")}
            className="flex-1 flex items-center justify-center gap-2 py-3 rounded-xl text-sm font-semibold transition-all active:scale-95"
            style={{ backgroundColor: "white", color: "var(--vovo-marrom)", border: "1.5px solid #e5e0da" }}
          >
            🛒 Lista de Compras
          </button>
        </div>

        <form onSubmit={handleBusca} className="flex gap-2 mb-3">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar receitas... 🔍"
            className="input-field flex-1"
          />
          <button type="submit" className="btn-primary px-4 py-2 text-sm">
            Buscar
          </button>
        </form>

        <div className="flex gap-2 overflow-x-auto pb-2 mb-3 scrollbar-hide">
          {CATEGORIAS.map((cat) => (
            <button
              key={cat.value}
              onClick={() => setCategoria(cat.value)}
              className="whitespace-nowrap px-3 py-1.5 rounded-full text-xs font-medium transition-all flex-shrink-0"
              style={{
                backgroundColor: categoria === cat.value ? "var(--vovo-marrom)" : "white",
                color: categoria === cat.value ? "white" : "var(--vovo-marrom)",
                border: "1.5px solid",
                borderColor: categoria === cat.value ? "var(--vovo-marrom)" : "#e5e0da",
              }}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {premium === false && (
          <Link
            href="/assinar"
            className="flex items-center gap-2 mb-3 px-3 py-2 rounded-xl text-xs font-medium"
            style={{ backgroundColor: "rgba(200,128,106,0.1)", color: "var(--vovo-rosa)" }}
          >
            <span>🔒</span>
            <span>Filtros por restrição disponíveis no Premium</span>
            <span className="ml-auto font-semibold">Ver planos →</span>
          </Link>
        )}

        {premium !== false && (
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4 scrollbar-hide">
            {TAGS.map((tag) => (
              <button
                key={tag.value}
                onClick={() => toggleTag(tag.value)}
                className="whitespace-nowrap px-3 py-1 rounded-full text-xs font-medium transition-all flex-shrink-0"
                style={{
                  backgroundColor: tagsSelecionadas.includes(tag.value) ? "var(--vovo-verde)" : "#f0ebe5",
                  color: tagsSelecionadas.includes(tag.value) ? "white" : "var(--vovo-marrom-mid)",
                }}
              >
                {tag.label}
              </button>
            ))}
          </div>
        )}

        {carregando && receitas.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--vovo-marrom-mid)" }}>
            <div className="text-4xl mb-2 animate-bounce">🍳</div>
            <p>Carregando receitas...</p>
          </div>
        ) : receitas.length === 0 ? (
          <div className="text-center py-12" style={{ color: "var(--vovo-marrom-mid)" }}>
            <div className="text-4xl mb-2">😔</div>
            <p>Nenhuma receita encontrada</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {receitas.map((r) => (
              <Link key={r.id} href={`/receitas/${r.id}`}>
                <div className="bg-white rounded-xl overflow-hidden shadow-sm hover:shadow-md transition-shadow">
                  <div className="h-32 relative overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#f5f0ea" }}>
                    {r.foto_url ? (
                      <img
                        src={optimizeUrl(r.foto_url, 400)}
                        alt={r.titulo}
                        loading="lazy"
                        decoding="async"
                        className="absolute inset-0 w-full h-full object-cover"
                      />
                    ) : (
                      <span className="text-4xl">🍽️</span>
                    )}
                  </div>
                  <div className="p-2">
                    <div className="flex items-start justify-between gap-1 mb-1">
                      <h3 className="text-xs font-semibold leading-tight line-clamp-2" style={{ color: "var(--vovo-marrom)" }}>
                        {r.titulo}
                      </h3>
                      {!premium && r.is_premium && !r.is_free_rotativa ? (
                        <span className="badge-lock flex-shrink-0">🔒</span>
                      ) : r.is_free_rotativa ? (
                        <span className="badge-free flex-shrink-0">Free</span>
                      ) : null}
                    </div>
                    <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>⏱ {r.tempo_preparo}min</p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}

        {hasMore && !carregando && (
          <button
            onClick={() => carregarReceitas()}
            className="w-full mt-4 py-3 rounded-xl text-sm font-medium"
            style={{ backgroundColor: "white", color: "var(--vovo-marrom)", border: "1.5px solid #e5e0da" }}
          >
            Carregar mais receitas
          </button>
        )}
      </div>
    </div>
  );
}
