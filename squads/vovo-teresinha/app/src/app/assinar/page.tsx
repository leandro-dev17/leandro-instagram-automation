"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import NavBar from "@/components/NavBar";

type UserData = {
  tipo_usuario: string;
  trial_inicio: string | null;
  trial_fim: string | null;
  plano: string | null;
};

const PLANOS = [
  {
    id: "trimestral",
    titulo: "Premium Trimestral",
    preco: "R$ 29,90",
    periodo: "/3 meses",
    destaque: false,
    badge: "Mais popular!",
    itens: [
      "Acesso a todas as +200 receitas",
      "Filtros por restrição alimentar",
      "Favoritos ilimitados",
      "Geladeira com IA",
      "Receitas do Personal Leandro",
      "Equivale a R$9,97/mês",
    ],
  },
  {
    id: "anual",
    titulo: "Premium Anual",
    preco: "R$ 79,90",
    periodo: "/ano",
    destaque: true,
    badge: "Melhor custo-benefício!",
    itens: [
      "Tudo do plano trimestral",
      "Programa de afiliados (ganhe indicando!)",
      "Equivale a R$6,65/mês",
      "Economize R$39,80 vs trimestral",
    ],
  },
];

function diasRestantes(trial_fim: string | null): number {
  if (!trial_fim) return 0;
  return Math.max(0, Math.ceil((new Date(trial_fim).getTime() - Date.now()) / 86400000));
}

export default function AssinarPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<UserData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [assindo, setAssindo] = useState<string | null>(null);
  const [ativandoTrial, setAtivandoTrial] = useState(false);
  const [erro, setErro] = useState("");

  useEffect(() => {
    fetch("/api/auth/me")
      .then((r) => {
        if (r.status === 401) {
          router.push("/login?redirect=/assinar");
          return null;
        }
        return r.json();
      })
      .then((data) => {
        if (data) setUsuario(data.dados);
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }, [router]);

  async function assinar(planoId: string) {
    setErro("");
    setAssindo(planoId);
    try {
      const res = await fetch("/api/assinaturas/criar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plano: planoId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.erro || "Erro ao criar assinatura. Tente novamente em alguns segundos.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      const url = data.dados?.init_point;
      if (!url) {
        setErro("Link de pagamento não gerado. Tente novamente.");
        window.scrollTo({ top: 0, behavior: "smooth" });
        return;
      }
      window.location.href = url;
    } catch {
      setErro("Erro de conexão. Tente novamente em alguns segundos.");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } finally {
      setAssindo(null);
    }
  }

  async function ativarTrial() {
    setAtivandoTrial(true);
    setErro("");
    try {
      const res = await fetch("/api/auth/trial", { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        setErro(data.erro || "Erro ao ativar trial");
        return;
      }
      setUsuario((u) => u ? { ...u, trial_fim: data.dados.trial_fim, trial_inicio: new Date().toISOString() } : u);
    } catch {
      setErro("Erro de conexão.");
    } finally {
      setAtivandoTrial(false);
    }
  }

  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--vovo-creme)" }}>
        <div className="text-4xl animate-bounce">💕</div>
      </div>
    );
  }

  // Already premium or aluna
  if (usuario?.tipo_usuario === "premium" || usuario?.tipo_usuario === "aluna_leandro") {
    return (
      <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
        <NavBar />
        <div className="flex flex-col items-center justify-center px-4 pt-16">
          <div className="text-6xl mb-4">✨</div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--vovo-marrom)" }}>
            Você já é Premium! 💕
          </h1>
          <p className="text-sm text-center mb-6" style={{ color: "var(--vovo-marrom-mid)" }}>
            {usuario.tipo_usuario === "aluna_leandro"
              ? "Você tem acesso completo como aluna do Personal Leandro."
              : `Plano ${usuario.plano || "Premium"} ativo.`}
          </p>
          <Link href="/receitas" className="btn-primary">
            Ver receitas
          </Link>
        </div>
      </div>
    );
  }

  const trialAtivo = usuario?.trial_fim && diasRestantes(usuario.trial_fim) > 0;
  const trialUsado = !!usuario?.trial_inicio;

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />

      {/* Toast de erro fixo no topo */}
      {erro && (
        <div
          className="fixed top-0 left-0 right-0 z-50 px-4 py-3 flex items-start gap-3"
          style={{ backgroundColor: "#dc2626", color: "white" }}
        >
          <span className="text-lg flex-shrink-0">⚠️</span>
          <p className="text-sm font-medium flex-1">{erro}</p>
          <button onClick={() => setErro("")} className="flex-shrink-0 text-white opacity-80 text-lg leading-none">✕</button>
        </div>
      )}

      <div className="flex flex-col items-center justify-start px-4 py-6" style={{ paddingTop: erro ? "4.5rem" : undefined }}>
      <button
        onClick={() => router.back()}
        className="self-start mb-4 text-sm font-medium"
        style={{ color: "var(--vovo-rosa)" }}
      >
        ← Voltar
      </button>

      <div className="text-center mb-8 max-w-sm">
        <div className="text-5xl mb-3">💕</div>
        <h1 className="text-2xl font-bold" style={{ color: "var(--vovo-marrom)" }}>
          Seja Premium
        </h1>
        <p className="text-sm mt-2" style={{ color: "var(--vovo-marrom-mid)" }}>
          Acesse +200 receitas e ferramentas exclusivas com o carinho da Vovó Teresinha!
        </p>
      </div>

      {/* Trial ativo — banner countdown */}
      {trialAtivo && (
        <div
          className="w-full max-w-sm rounded-2xl p-4 mb-4 text-center"
          style={{ backgroundColor: "rgba(107,143,113,0.12)", border: "1.5px solid var(--vovo-verde)" }}
        >
          <p className="font-semibold text-sm" style={{ color: "var(--vovo-verde)" }}>
            ⏰ Seu trial termina em {diasRestantes(usuario!.trial_fim)} dia{diasRestantes(usuario!.trial_fim) !== 1 ? "s" : ""}
          </p>
          <p className="text-xs mt-1" style={{ color: "var(--vovo-marrom-mid)" }}>
            Assine agora para não perder o acesso!
          </p>
        </div>
      )}

      {/* Trial disponível — oferta */}
      {!trialUsado && !trialAtivo && (
        <div
          className="w-full max-w-sm rounded-2xl p-5 mb-6"
          style={{ backgroundColor: "white", border: "2px solid var(--vovo-rosa)" }}
        >
          <div className="text-center">
            <p className="text-3xl mb-2">🎁</p>
            <h3 className="font-bold mb-1" style={{ color: "var(--vovo-marrom)" }}>
              7 dias grátis!
            </h3>
            <p className="text-sm mb-4" style={{ color: "var(--vovo-marrom-mid)" }}>
              Experimente o Premium por 7 dias sem pagar nada. Sem cartão necessário!
            </p>
            <button
              onClick={ativarTrial}
              disabled={ativandoTrial}
              className="btn-primary w-full"
            >
              {ativandoTrial ? "Ativando..." : "Ativar 7 dias grátis ✨"}
            </button>
          </div>
        </div>
      )}

      <div className="w-full max-w-sm space-y-4">
        {PLANOS.map((plano) => (
          <div
            key={plano.id}
            className="rounded-2xl overflow-hidden"
            style={{
              border: plano.destaque ? "2px solid var(--vovo-rosa)" : "2px solid #e5e0da",
              backgroundColor: "white",
            }}
          >
            {"badge" in plano && plano.badge && (
              <div
                className="text-center py-1.5 text-xs font-bold text-white"
                style={{ backgroundColor: plano.destaque ? "var(--vovo-rosa)" : "var(--vovo-laranja)" }}
              >
                {plano.destaque ? "⭐" : "🔥"} {plano.badge}
              </div>
            )}
            <div className="p-5">
              <div className="flex items-baseline gap-1 mb-3">
                <span className="text-3xl font-bold" style={{ color: "var(--vovo-marrom)" }}>
                  {plano.preco}
                </span>
                <span className="text-sm" style={{ color: "var(--vovo-lock)" }}>{plano.periodo}</span>
              </div>
              <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>
                {plano.titulo}
              </h3>
              <ul className="space-y-1.5 mb-5">
                {plano.itens.map((item) => (
                  <li key={item} className="flex items-start gap-2 text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
                    <span className="text-green-500 mt-0.5">✓</span>
                    {item}
                  </li>
                ))}
              </ul>
              <button
                onClick={() => assinar(plano.id)}
                disabled={assindo !== null}
                className={plano.destaque ? "btn-primary w-full" : "btn-secondary w-full"}
              >
                {assindo === plano.id ? "Redirecionando..." : `Assinar ${plano.titulo}`}
              </button>
            </div>
          </div>
        ))}

        <p className="text-xs text-center mt-2" style={{ color: "var(--vovo-lock)" }}>
          Pagamento seguro via Mercado Pago. Cancele quando quiser.
        </p>
      </div>
      </div>
    </div>
  );
}
