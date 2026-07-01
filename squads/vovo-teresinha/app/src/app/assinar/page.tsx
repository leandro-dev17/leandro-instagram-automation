"use client";

import { useState, useEffect, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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
    id: "caderninho",
    titulo: "Caderninho",
    emoji: "📒",
    preco: "R$ 9,90",
    periodo: "/mês",
    destaque: false,
    badge: null as string | null,
    trial: false,
    valorCobranca: 9.9,
    itens: [
      "80 receitas selecionadas pela Vovó",
      "Café da manhã, almoço, jantares e doces",
      "Receita do Dia toda semana",
      "Favoritos ilimitados",
      "Novas receitas toda semana",
    ],
  },
  {
    id: "livro_receitas",
    titulo: "Livro de Receitas",
    emoji: "📖",
    preco: "R$ 19,90",
    periodo: "/mês",
    destaque: true,
    badge: "Mais completo!" as string | null,
    trial: true,
    valorCobranca: 19.9,
    itens: [
      "400+ receitas e crescendo todo mês",
      "Todos os tipos e categorias",
      "Filtros: sem glúten, low carb, vegano e mais",
      "Geladeira Inteligente com IA",
      "Plano Semanal automático",
      "Lista de compras integrada",
      "Receitas especiais do Personal Leandro",
    ],
  },
];

function diasRestantes(trial_fim: string | null): number {
  if (!trial_fim) return 0;
  return Math.max(0, Math.ceil((new Date(trial_fim).getTime() - Date.now()) / 86400000));
}

function AssinarForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const refParam = searchParams.get("ref") || "";
  const [usuario, setUsuario] = useState<UserData | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [assindo, setAssindo] = useState<string | null>(null);
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
        body: JSON.stringify({ plano: planoId, codigo_afiliado: refParam || undefined }),
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

  if (carregando) {
    return (
      <div className="min-h-screen flex items-center justify-center" style={{ backgroundColor: "var(--vovo-creme)" }}>
        <div className="text-4xl animate-bounce">💕</div>
      </div>
    );
  }

  const trialAtivo = !!usuario?.trial_fim && diasRestantes(usuario.trial_fim) > 0;

  if (
    usuario?.tipo_usuario === "aluna_leandro" ||
    usuario?.tipo_usuario === "admin" ||
    usuario?.tipo_usuario === "premium"
  ) {
    const planoLabel = usuario.plano === "caderninho" ? "Caderninho 📒" : "Livro de Receitas 📖";
    return (
      <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
        <NavBar />
        <div className="flex flex-col items-center justify-center px-4 pt-16">
          <div className="text-6xl mb-4">✨</div>
          <h1 className="text-2xl font-bold mb-2" style={{ color: "var(--vovo-marrom)" }}>
            Você já faz parte! 💕
          </h1>
          <p className="text-sm text-center mb-6" style={{ color: "var(--vovo-marrom-mid)" }}>
            {usuario.tipo_usuario === "aluna_leandro"
              ? "Você tem acesso completo como aluna do Personal Leandro."
              : `Plano ${planoLabel} ativo${trialAtivo ? ` — seu teste grátis termina em ${diasRestantes(usuario.trial_fim)} dia${diasRestantes(usuario.trial_fim) !== 1 ? "s" : ""}` : ""}.`}
          </p>
          <Link href="/receitas" className="btn-primary">
            Ver receitas
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />

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

      <div className="flex flex-col items-center px-4 py-6" style={{ paddingTop: erro ? "4.5rem" : undefined }}>
        <button
          onClick={() => router.back()}
          className="self-start mb-4 text-sm font-medium"
          style={{ color: "var(--vovo-rosa)" }}
        >
          ← Voltar
        </button>

        <div className="text-center mb-6 max-w-sm">
          <div className="text-5xl mb-3">💕</div>
          <h1 className="text-2xl font-bold" style={{ color: "var(--vovo-marrom)" }}>
            Venha fazer parte!
          </h1>
          <p className="text-sm mt-2" style={{ color: "var(--vovo-marrom-mid)" }}>
            A Vovó Teresinha está te esperando com receitas novas toda semana!
          </p>
        </div>

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
              {plano.badge && (
                <div
                  className="text-center py-1.5 text-xs font-bold text-white"
                  style={{ backgroundColor: "var(--vovo-rosa)" }}
                >
                  ⭐ {plano.badge}
                </div>
              )}
              <div className="p-5">
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-2xl">{plano.emoji}</span>
                  <h3 className="text-lg font-bold" style={{ color: "var(--vovo-marrom)" }}>
                    {plano.titulo}
                  </h3>
                </div>
                <div className="flex items-baseline gap-1 mb-4">
                  <span className="text-3xl font-bold" style={{ color: "var(--vovo-marrom)" }}>
                    {plano.preco}
                  </span>
                  <span className="text-sm" style={{ color: "var(--vovo-lock)" }}>{plano.periodo}</span>
                </div>
                <ul className="space-y-2 mb-5">
                  {plano.itens.map((item) => (
                    <li key={item} className="flex items-start gap-2 text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>
                      <span className="text-green-500 mt-0.5 flex-shrink-0">✓</span>
                      {item}
                    </li>
                  ))}
                </ul>
                <button
                  onClick={() => assinar(plano.id)}
                  disabled={assindo !== null}
                  className={plano.destaque ? "btn-primary w-full" : "btn-secondary w-full"}
                >
                  {assindo === plano.id
                    ? "Redirecionando..."
                    : plano.trial
                    ? `Experimentar 7 dias grátis`
                    : `Começar agora`}
                </button>
                <p className="text-xs text-center mt-2" style={{ color: "var(--vovo-lock)" }}>
                  {plano.trial
                    ? "7 dias grátis, depois R$19,90/mês. Cancele quando quiser."
                    : "Pagamento via Mercado Pago. Cancele quando quiser."}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export default function AssinarPage() {
  return (
    <Suspense>
      <AssinarForm />
    </Suspense>
  );
}
