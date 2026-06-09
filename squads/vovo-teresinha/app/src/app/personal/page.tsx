"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

type Receita = {
  id: number;
  titulo: string;
  descricao: string;
  categoria: string;
  refeicao: string | null;
  tempo_preparo: number;
  calorias: number | null;
  foto_url: string | null;
  tags_restricao: string[];
};

const TABS = [
  { key: "cafe", label: "Café da Manhã", emoji: "☀️", categorias: ["cafe_manha", "sucos_molhos"] },
  { key: "tarde", label: "Lanches & Doces", emoji: "🌤️", categorias: ["lanches_snacks", "doces_sobremesas", "bolos_tortas"] },
  { key: "noite", label: "Almoço & Jantar", emoji: "🌙", categorias: ["pratos_principais", "sopas_caldos", "saladas"] },
];

function filtrarPorTab(receitas: Receita[], tabKey: string): Receita[] {
  const tab = TABS.find((t) => t.key === tabKey);
  if (!tab) return receitas;

  const filtered = receitas.filter((r) =>
    r.refeicao === tabKey ||
    tab.categorias.includes(r.refeicao || "") ||
    tab.categorias.includes(r.categoria)
  );

  // Se não houver filtro específico, mostra todas (evita tab vazia)
  return filtered.length > 0 ? filtered : receitas;
}

function optimizeUrl(url: string, width: number): string {
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/w_${width},f_auto,q_auto,c_fill/`);
  }
  return url;
}

export default function PersonalPage() {
  const [receitas, setReceitas] = useState<Receita[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState("");
  const [premium, setPremium] = useState<boolean | null>(null);
  const [tabAtiva, setTabAtiva] = useState("cafe");

  useEffect(() => {
    fetch("/api/personal/receitas")
      .then((r) => r.json())
      .then((data) => {
        if (data.dados) {
          setPremium(true);
          setReceitas(data.dados);
        } else if (data.premium === false) {
          setPremium(false);
        } else {
          setErro(data.erro || "Erro ao carregar");
        }
        setCarregando(false);
      })
      .catch(() => {
        setErro("Erro de conexão");
        setCarregando(false);
      });
  }, []);

  const receitasTab = filtrarPorTab(receitas, tabAtiva);

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />

      {/* Header gradiente terracotta/laranja */}
      <div
        className="px-4 pt-5 pb-5"
        style={{ background: "linear-gradient(135deg, #C8806A 0%, #E8A87C 50%, #D4956B 100%)" }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-2xl bg-white bg-opacity-20 flex items-center justify-center text-2xl">
              💪
            </div>
            <div>
              <h1 className="text-xl font-bold text-white">
                Receitinhas do Personal
              </h1>
              <p className="text-xs text-white opacity-80">
                Curadas especialmente pelo Personal Leandro
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div style={{ backgroundColor: "white", borderBottom: "1px solid #f0ebe5" }}>
        <div className="max-w-2xl mx-auto flex">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setTabAtiva(tab.key)}
              className="flex-1 py-3 text-xs font-semibold transition-all"
              style={{
                color: tabAtiva === tab.key ? "var(--vovo-rosa)" : "var(--vovo-marrom-mid)",
                borderBottom: tabAtiva === tab.key ? "2.5px solid var(--vovo-rosa)" : "2.5px solid transparent",
              }}
            >
              <span className="text-base block mb-0.5">{tab.emoji}</span>
              {tab.label}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 max-w-2xl mx-auto">
        {carregando ? (
          <div className="text-center py-12">
            <div className="text-4xl animate-bounce">💪</div>
          </div>
        ) : premium === false ? (
          <div className="text-center py-12">
            <div className="text-5xl mb-3">🔒</div>
            <h3 className="font-bold mb-2" style={{ color: "var(--vovo-marrom)" }}>
              Acesso exclusivo premium
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--vovo-marrom-mid)" }}>
              As receitas do Personal Leandro são exclusivas para membros premium!
            </p>
            <Link href="/assinar" className="btn-primary">Ver planos</Link>
          </div>
        ) : erro ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>{erro}</p>
          </div>
        ) : receitasTab.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">🍽️</div>
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
              Nenhuma receita disponível nessa categoria ainda
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            {receitasTab.map((r) => (
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
                      <span className="text-4xl">💪</span>
                    )}
                  </div>
                  <div className="p-2">
                    <h3 className="text-xs font-semibold line-clamp-2" style={{ color: "var(--vovo-marrom)" }}>
                      {r.titulo}
                    </h3>
                    <p className="text-xs mt-1" style={{ color: "var(--vovo-lock)" }}>
                      ⏱ {r.tempo_preparo}min{r.calorias ? ` • 🔥 ${r.calorias}kcal` : ""}
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
