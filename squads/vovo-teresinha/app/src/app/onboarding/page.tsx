"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

const CATEGORIAS = [
  { value: "doces_bolos", label: "Doces e bolos", emoji: "🍰" },
  { value: "pratos_dia", label: "Pratos do dia a dia", emoji: "🍲" },
  { value: "sopas_caldos", label: "Sopas e caldos", emoji: "🥣" },
  { value: "saladas_leveza", label: "Saladas e leveza", emoji: "🥗" },
];

const PREFERENCIAS = [
  { value: "sem_gluten", label: "Sem glúten" },
  { value: "sem_lactose", label: "Sem lactose" },
  { value: "low_carb", label: "Low carb" },
  { value: "sem_acucar", label: "Sem açúcar" },
];

const WHATSAPP_GRUPO = "https://chat.whatsapp.com/EqQVQUAFOe40ZqWgci3fuv";

export default function OnboardingPage() {
  const router = useRouter();
  const [etapa, setEtapa] = useState(1);
  const [categorias, setCategorias] = useState<string[]>([]);
  const [preferencias, setPreferencias] = useState<string[]>([]);
  const [pushAtivado, setPushAtivado] = useState(false);
  const [ativandoPush, setAtivandoPush] = useState(false);

  function toggleCategoria(val: string) {
    setCategorias((c) => c.includes(val) ? c.filter((x) => x !== val) : [...c, val]);
  }

  function togglePreferencia(val: string) {
    setPreferencias((p) => p.includes(val) ? p.filter((x) => x !== val) : [...p, val]);
  }

  function salvarEAvancar() {
    if (typeof window !== "undefined") {
      sessionStorage.setItem("vovo_categorias", categorias.join(","));
      sessionStorage.setItem("vovo_preferencias", preferencias.join(","));
    }
    setEtapa(3);
  }

  function pularParaAssinar() {
    router.push("/assinar?origem=onboarding");
  }

  async function ativarPush() {
    if (!("Notification" in window)) return;
    setAtivandoPush(true);
    try {
      const permission = await Notification.requestPermission();
      if (permission === "granted") {
        const reg = await navigator.serviceWorker.ready;
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
        });
        await fetch("/api/push/subscribe", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(sub.toJSON()),
        });
        setPushAtivado(true);
      }
    } catch {
      // browser pode não suportar push
    } finally {
      setAtivandoPush(false);
    }
  }

  return (
    <div
      className="min-h-screen flex flex-col"
      style={{ background: "var(--vovo-creme, #f5e6d3)" }}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-5 pb-2">
        <div className="text-2xl font-bold" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
          🌸 Vovó Teresinha
        </div>
        <button
          onClick={pularParaAssinar}
          className="text-sm"
          style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.5 }}
        >
          Pular
        </button>
      </div>

      {/* Progresso */}
      <div className="flex gap-2 px-5 pb-4">
        {[1, 2, 3].map((n) => (
          <div
            key={n}
            className="h-1 flex-1 rounded-full transition-all"
            style={{
              background: n <= etapa
                ? "var(--vovo-laranja, #e67e22)"
                : "rgba(107,88,66,0.15)",
            }}
          />
        ))}
      </div>

      <div className="flex-1 px-5 pb-8">
        {/* Passo 1: Categorias */}
        {etapa === 1 && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: "var(--vovo-laranja, #e67e22)" }}>
                Passo 1 de 3
              </p>
              <h1 className="text-2xl font-bold leading-snug" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
                O que você ama comer? 💕
              </h1>
              <p className="text-sm mt-1" style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.6 }}>
                A vovó quer preparar as melhores receitinhas pra você!
              </p>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {CATEGORIAS.map((c) => (
                <button
                  key={c.value}
                  onClick={() => toggleCategoria(c.value)}
                  className="p-4 rounded-2xl border-2 text-left transition-all active:scale-95"
                  style={{
                    borderColor: categorias.includes(c.value)
                      ? "var(--vovo-laranja, #e67e22)"
                      : "rgba(107,88,66,0.15)",
                    background: categorias.includes(c.value)
                      ? "rgba(230,126,34,0.08)"
                      : "white",
                  }}
                >
                  <div className="text-2xl mb-1">{c.emoji}</div>
                  <div className="text-sm font-semibold leading-tight" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
                    {c.label}
                  </div>
                </button>
              ))}
            </div>

            <button
              onClick={() => setEtapa(2)}
              disabled={categorias.length === 0}
              className="w-full py-4 rounded-2xl font-bold text-base transition-all active:scale-95 disabled:opacity-40"
              style={{ background: "var(--vovo-laranja, #e67e22)", color: "white" }}
            >
              Continuar →
            </button>
          </div>
        )}

        {/* Passo 2: Preferências */}
        {etapa === 2 && (
          <div className="space-y-6">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: "var(--vovo-laranja, #e67e22)" }}>
                Passo 2 de 3
              </p>
              <h1 className="text-2xl font-bold leading-snug" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
                Tem alguma preferência especial? 🌿
              </h1>
              <p className="text-sm mt-1" style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.6 }}>
                Sem pressão, meu amor — pode deixar em branco!
              </p>
            </div>

            <div className="flex flex-col gap-2">
              {PREFERENCIAS.map((p) => (
                <button
                  key={p.value}
                  onClick={() => togglePreferencia(p.value)}
                  className="p-4 rounded-2xl border-2 text-left font-medium transition-all active:scale-95 flex items-center justify-between"
                  style={{
                    borderColor: preferencias.includes(p.value)
                      ? "var(--vovo-laranja, #e67e22)"
                      : "rgba(107,88,66,0.15)",
                    background: preferencias.includes(p.value)
                      ? "rgba(230,126,34,0.08)"
                      : "white",
                    color: "var(--vovo-marrom, #6b5842)",
                  }}
                >
                  <span>{p.label}</span>
                  {preferencias.includes(p.value) && (
                    <span style={{ color: "var(--vovo-laranja, #e67e22)" }}>✓</span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEtapa(1)}
                className="flex-1 py-4 rounded-2xl font-semibold border-2 transition-all active:scale-95"
                style={{ borderColor: "rgba(107,88,66,0.2)", color: "var(--vovo-marrom, #6b5842)" }}
              >
                ← Voltar
              </button>
              <button
                onClick={salvarEAvancar}
                className="flex-2 flex-grow py-4 rounded-2xl font-bold transition-all active:scale-95"
                style={{ background: "var(--vovo-laranja, #e67e22)", color: "white" }}
              >
                Continuar →
              </button>
            </div>
          </div>
        )}

        {/* Passo 3: Comunidade WhatsApp + Push */}
        {etapa === 3 && (
          <div className="space-y-5">
            <div>
              <p className="text-xs font-medium uppercase tracking-wide mb-2" style={{ color: "var(--vovo-laranja, #e67e22)" }}>
                Passo 3 de 3
              </p>
              <h1 className="text-2xl font-bold leading-snug" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
                Fique por dentro de tudo! 💌
              </h1>
              <p className="text-sm mt-1" style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.6 }}>
                A vovó tem um gruinho especial no WhatsApp pra você!
              </p>
            </div>

            {/* Card WhatsApp grupo */}
            <a
              href={WHATSAPP_GRUPO}
              target="_blank"
              rel="noopener noreferrer"
              className="block p-4 rounded-2xl transition-all active:scale-95"
              style={{
                background: "linear-gradient(135deg, #25D366 0%, #128C7E 100%)",
                color: "white",
              }}
            >
              <div className="flex items-center gap-3">
                <div className="text-3xl">💬</div>
                <div>
                  <p className="font-bold text-base">Grupo VIP da Vovó no WhatsApp</p>
                  <p className="text-sm opacity-90 mt-0.5">
                    Receitas exclusivas, dicas e a comunidade mais gostosa do Brasil! 🇧🇷
                  </p>
                </div>
                <span className="ml-auto text-xl opacity-80">→</span>
              </div>
            </a>

            {/* Card notificações push */}
            <div
              className="p-4 rounded-2xl"
              style={{ background: "white", border: "2px solid #f0ebe5" }}
            >
              <div className="flex items-center gap-3">
                <div className="text-3xl">🔔</div>
                <div className="flex-1">
                  <p className="font-bold text-sm" style={{ color: "var(--vovo-marrom, #6b5842)" }}>
                    Receba a receita do dia!
                  </p>
                  <p className="text-xs mt-0.5" style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.6 }}>
                    Uma receitinha nova toda manhã no seu celular 🌅
                  </p>
                </div>
                {pushAtivado ? (
                  <span className="text-sm font-semibold" style={{ color: "#25D366" }}>✓ Ativo</span>
                ) : (
                  <button
                    onClick={ativarPush}
                    disabled={ativandoPush}
                    className="text-xs font-semibold px-3 py-2 rounded-xl transition-all active:scale-95"
                    style={{ background: "var(--vovo-laranja, #e67e22)", color: "white" }}
                  >
                    {ativandoPush ? "..." : "Ativar"}
                  </button>
                )}
              </div>
            </div>

            <div className="flex gap-3 pt-2">
              <button
                onClick={() => setEtapa(2)}
                className="flex-1 py-4 rounded-2xl font-semibold border-2 transition-all active:scale-95"
                style={{ borderColor: "rgba(107,88,66,0.2)", color: "var(--vovo-marrom, #6b5842)" }}
              >
                ← Voltar
              </button>
              <button
                onClick={pularParaAssinar}
                className="flex-2 flex-grow py-4 rounded-2xl font-bold transition-all active:scale-95"
                style={{ background: "var(--vovo-laranja, #e67e22)", color: "white" }}
              >
                Ver receitas ✨
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="px-5 pb-6 text-center">
        <p className="text-xs" style={{ color: "var(--vovo-marrom, #6b5842)", opacity: 0.45 }}>
          Já tem conta?{" "}
          <Link href="/login" style={{ color: "var(--vovo-laranja, #e67e22)" }}>
            Entrar
          </Link>
        </p>
      </div>
    </div>
  );
}
