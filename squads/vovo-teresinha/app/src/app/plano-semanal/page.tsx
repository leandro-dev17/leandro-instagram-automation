"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import NavBar from "@/components/NavBar";

type SlotReceita = {
  slot: string;
  receita_id: number | null;
  titulo: string | null;
  foto_url: string | null;
  tempo_preparo: number | null;
  categoria: string | null;
};

type PlanoSemanal = {
  semana: string;
  plano: SlotReceita[];
  gerado: boolean;
};

const DIAS_LABELS: Record<string, string> = {
  seg: "Segunda",
  ter: "Terça",
  qua: "Quarta",
  qui: "Quinta",
  sex: "Sexta",
  sab: "Sábado",
  dom: "Domingo",
};

const DIAS_SHORT: Record<string, string> = {
  seg: "Seg",
  ter: "Ter",
  qua: "Qua",
  qui: "Qui",
  sex: "Sex",
  sab: "Sáb",
  dom: "Dom",
};

const REFEICOES_LABELS: Record<string, { label: string; emoji: string }> = {
  cafe: { label: "Café da manhã", emoji: "☀️" },
  almoco: { label: "Almoço", emoji: "🍽️" },
  lanche: { label: "Lanche", emoji: "🌤️" },
  jantar: { label: "Jantar", emoji: "🌙" },
};

const DIAS = ["seg", "ter", "qua", "qui", "sex", "sab", "dom"];
const REFEICOES = ["cafe", "almoco", "lanche", "jantar"];

function formatarSemana(semana: string): string {
  const d = new Date(semana + "T12:00:00");
  const fim = new Date(d);
  fim.setDate(fim.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: "numeric", month: "short" };
  return `${d.toLocaleDateString("pt-BR", opts)} – ${fim.toLocaleDateString("pt-BR", opts)}`;
}

function optimizeUrl(url: string, width: number): string {
  if (url.includes("res.cloudinary.com") && url.includes("/upload/")) {
    return url.replace("/upload/", `/upload/w_${width},f_auto,q_auto,c_fill/`);
  }
  return url;
}

export default function PlanoSemanalPage() {
  const [plano, setPlano] = useState<PlanoSemanal | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [regenerando, setRegenerando] = useState(false);
  const [premium, setPremium] = useState<boolean | null>(null);
  const [diaAtivo, setDiaAtivo] = useState(DIAS[0]);
  const [erro, setErro] = useState("");

  useEffect(() => {
    const hoje = new Date().getDay();
    // 0=dom, 1=seg... mapear para nosso array
    const idx = hoje === 0 ? 6 : hoje - 1;
    setDiaAtivo(DIAS[idx]);

    carregar();
  }, []);

  async function carregar() {
    setCarregando(true);
    setErro("");
    try {
      const res = await fetch("/api/plano-semanal");
      const data = await res.json();
      if (res.status === 403) { setPremium(false); return; }
      if (!res.ok) { setErro(data.erro || "Erro ao carregar"); return; }
      setPremium(true);
      setPlano(data);
    } catch {
      setErro("Erro de conexão. Tente novamente.");
    } finally {
      setCarregando(false);
    }
  }

  async function regenerar() {
    setRegenerando(true);
    try {
      const res = await fetch("/api/plano-semanal", { method: "POST" });
      const data = await res.json();
      if (res.ok) setPlano(data);
    } catch {
      // silently fail
    } finally {
      setRegenerando(false);
    }
  }

  function getSlot(dia: string, refeicao: string): SlotReceita | undefined {
    return plano?.plano.find((s) => s.slot === `${dia}_${refeicao}`);
  }

  if (premium === false) {
    return (
      <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
        <NavBar />
        <div className="flex flex-col items-center justify-center px-4 pt-20">
          <div className="text-6xl mb-4">📅</div>
          <h1 className="text-xl font-bold mb-2 text-center" style={{ color: "var(--vovo-marrom)" }}>
            Plano Semanal
          </h1>
          <p className="text-sm text-center mb-6" style={{ color: "var(--vovo-marrom-mid)" }}>
            O plano semanal é exclusivo para membros premium. A vovó organiza toda a semana de receitas pra você! 💕
          </p>
          <Link href="/assinar" className="btn-primary">Ver planos premium</Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />

      {/* Header gradiente */}
      <div
        className="px-4 pt-5 pb-4"
        style={{ background: "linear-gradient(135deg, #C8806A 0%, #E8A87C 100%)" }}
      >
        <div className="max-w-2xl mx-auto">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-xl font-bold text-white">📅 Plano Semanal</h1>
              {plano && (
                <p className="text-xs text-white opacity-80 mt-0.5">
                  {formatarSemana(plano.semana)}
                </p>
              )}
            </div>
            <button
              onClick={regenerar}
              disabled={regenerando || carregando}
              className="text-xs font-semibold px-3 py-2 rounded-xl transition-all active:scale-95"
              style={{ backgroundColor: "rgba(255,255,255,0.25)", color: "white" }}
            >
              {regenerando ? "⏳" : "🔄 Novo plano"}
            </button>
          </div>
        </div>
      </div>

      {/* Seletor de dias */}
      <div className="sticky top-0 z-10 px-4 py-3 overflow-x-auto" style={{ backgroundColor: "white", borderBottom: "1px solid #f0ebe5" }}>
        <div className="flex gap-2 max-w-2xl mx-auto">
          {DIAS.map((dia) => (
            <button
              key={dia}
              onClick={() => setDiaAtivo(dia)}
              className="flex-shrink-0 px-3 py-2 rounded-xl text-xs font-semibold transition-all active:scale-95"
              style={{
                backgroundColor: diaAtivo === dia ? "var(--vovo-rosa)" : "#f5f0ea",
                color: diaAtivo === dia ? "white" : "var(--vovo-marrom)",
              }}
            >
              {DIAS_SHORT[dia]}
            </button>
          ))}
        </div>
      </div>

      <div className="px-4 pt-4 max-w-2xl mx-auto">
        {carregando ? (
          <div className="text-center py-16">
            <div className="text-4xl animate-bounce mb-3">📅</div>
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
              A vovó está montando seu plano...
            </p>
          </div>
        ) : erro ? (
          <div className="text-center py-12">
            <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>{erro}</p>
            <button onClick={carregar} className="btn-primary mt-4">Tentar novamente</button>
          </div>
        ) : (
          <div className="space-y-3">
            <h2 className="text-base font-bold" style={{ color: "var(--vovo-marrom)" }}>
              {DIAS_LABELS[diaAtivo]} 🍽️
            </h2>
            {REFEICOES.map((ref) => {
              const slot = getSlot(diaAtivo, ref);
              const info = REFEICOES_LABELS[ref];
              return (
                <div key={ref} className="card">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="text-lg">{info.emoji}</span>
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: "var(--vovo-marrom-mid)" }}>
                      {info.label}
                    </span>
                  </div>

                  {slot?.receita_id ? (
                    <Link href={`/receitas/${slot.receita_id}`} className="flex items-center gap-3 hover:opacity-80 transition-opacity">
                      <div className="w-14 h-14 rounded-xl flex-shrink-0 relative overflow-hidden flex items-center justify-center" style={{ backgroundColor: "#f5f0ea" }}>
                        {slot.foto_url ? (
                          <img
                            src={optimizeUrl(slot.foto_url, 120)}
                            alt={slot.titulo ?? ""}
                            loading="lazy"
                            decoding="async"
                            className="absolute inset-0 w-full h-full object-cover"
                          />
                        ) : (
                          <span className="text-2xl">🍽️</span>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold line-clamp-2" style={{ color: "var(--vovo-marrom)" }}>
                          {slot.titulo}
                        </p>
                        {slot.tempo_preparo && (
                          <p className="text-xs mt-0.5" style={{ color: "var(--vovo-lock)" }}>
                            ⏱ {slot.tempo_preparo} min
                          </p>
                        )}
                      </div>
                      <span style={{ color: "var(--vovo-rosa)" }}>→</span>
                    </Link>
                  ) : (
                    <div className="flex items-center gap-2 py-1" style={{ color: "var(--vovo-lock)" }}>
                      <span className="text-xl">➕</span>
                      <p className="text-sm">Não planejado</p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {!carregando && plano && (
          <p className="text-center text-xs mt-6 mb-2" style={{ color: "var(--vovo-lock)" }}>
            💡 Toque em uma receita para ver o preparo completo
          </p>
        )}
      </div>
    </div>
  );
}
