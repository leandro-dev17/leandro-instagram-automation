"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import NavBar from "@/components/NavBar";

type Usuario = {
  id: number;
  nome: string;
  email: string;
  whatsapp: string | null;
  tipo_usuario: string;
  plano: string | null;
  trial_inicio: string | null;
  trial_fim: string | null;
  created_at: string;
};

export default function PerfilPage() {
  const router = useRouter();
  const [usuario, setUsuario] = useState<Usuario | null>(null);
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState("");
  const [whatsapp, setWhatsapp] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [carregando, setCarregando] = useState(true);
  const [pushAtivo, setPushAtivo] = useState(false);
  const [togglendoPush, setTogglendoPush] = useState(false);
  const [pausando, setPausando] = useState(false);
  const [cancelando, setCancelando] = useState(false);
  const [confirmaCancelar, setConfirmaCancelar] = useState(false);

  useEffect(() => {
    fetch("/api/usuarios/perfil")
      .then((r) => r.json())
      .then((data) => {
        setUsuario(data.dados);
        setNome(data.dados?.nome || "");
        setWhatsapp(data.dados?.whatsapp || "");
        setCarregando(false);
      })
      .catch(() => setCarregando(false));

    fetch("/api/push/subscribe")
      .then((r) => r.json())
      .then((d) => setPushAtivo(d.ativo ?? false))
      .catch(() => {});
  }, []);

  async function salvarPerfil() {
    setSalvando(true);
    await fetch("/api/usuarios/perfil", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ nome, whatsapp }),
    });
    setUsuario((u) => u ? { ...u, nome, whatsapp } : u);
    setEditando(false);
    setSalvando(false);
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function pausarAssinatura() {
    setPausando(true);
    try {
      const res = await fetch("/api/assinaturas/pausar", { method: "POST" });
      if (res.ok) {
        setUsuario((u) => u ? { ...u, tipo_usuario: "free" } : u);
        alert("Assinatura pausada. Você pode retomar quando quiser no painel do Mercado Pago.");
      }
    } catch {
      // silently fail
    } finally {
      setPausando(false);
    }
  }

  async function cancelarAssinatura() {
    if (!confirmaCancelar) { setConfirmaCancelar(true); return; }
    setCancelando(true);
    try {
      const res = await fetch("/api/assinaturas/pausar", { method: "DELETE" });
      if (res.ok) {
        setUsuario((u) => u ? { ...u, tipo_usuario: "free" } : u);
        setConfirmaCancelar(false);
      }
    } catch {
      // silently fail
    } finally {
      setCancelando(false);
    }
  }

  async function togglePush() {
    setTogglendoPush(true);
    try {
      if (pushAtivo) {
        await fetch("/api/push/subscribe", { method: "DELETE" });
        setPushAtivo(false);
      } else {
        if (!("Notification" in window)) return;
        const permission = await Notification.requestPermission();
        if (permission !== "granted") return;
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
        setPushAtivo(true);
      }
    } catch {
      // silently fail — browser may not support push
    } finally {
      setTogglendoPush(false);
    }
  }

  const planoLabel: Record<string, string> = {
    caderninho: "Caderninho",
    livro_receitas: "Livro de Receitas",
  };

  // Contas antigas (premium sem plano definido) equivalem ao Livro de Receitas completo
  const planoAtualLabel = planoLabel[usuario?.plano || ""] || "Livro de Receitas";

  const tipoLabel: Record<string, string> = {
    free: "Gratuito",
    premium: planoAtualLabel,
    aluna_leandro: "Aluna do Personal",
    admin: "Administrador",
  };

  return (
    <div className="min-h-screen pb-24" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <NavBar />
      <div className="px-4 pt-4 max-w-2xl mx-auto">
        <h1 className="text-xl font-bold mb-4 flex items-center gap-2" style={{ color: "var(--vovo-marrom)" }}>
          👤 Meu Perfil
        </h1>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">👤</div></div>
        ) : !usuario ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-3">😕</div>
            <p className="text-sm mb-4" style={{ color: "var(--vovo-marrom-mid)" }}>Não foi possível carregar seu perfil.</p>
            <button onClick={() => window.location.reload()} className="btn-primary text-sm">Tentar novamente</button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="card">
              <div className="flex items-center gap-3 mb-4">
                <div
                  className="w-14 h-14 rounded-full flex items-center justify-center text-2xl font-bold text-white"
                  style={{ backgroundColor: "var(--vovo-rosa)" }}
                >
                  {usuario.nome.charAt(0).toUpperCase()}
                </div>
                <div>
                  <h2 className="font-bold" style={{ color: "var(--vovo-marrom)" }}>{usuario.nome}</h2>
                  <p className="text-sm" style={{ color: "var(--vovo-marrom-mid)" }}>{usuario.email}</p>
                  {(() => {
                    const trialAtivo = usuario.trial_fim && new Date(usuario.trial_fim) > new Date();
                    const badge = trialAtivo ? "Trial" : (tipoLabel[usuario.tipo_usuario] || usuario.tipo_usuario);
                    const bg = usuario.tipo_usuario === "premium" || usuario.tipo_usuario === "aluna_leandro"
                      ? "#e8f5e9" : trialAtivo ? "#fff3e0" : "#f0ebe5";
                    const color = usuario.tipo_usuario === "premium" || usuario.tipo_usuario === "aluna_leandro"
                      ? "var(--vovo-verde)" : trialAtivo ? "var(--vovo-laranja)" : "var(--vovo-lock)";
                    return (
                      <span className="text-xs font-medium px-2 py-0.5 rounded-full" style={{ backgroundColor: bg, color }}>
                        {badge}
                      </span>
                    );
                  })()}
                </div>
              </div>

              {editando ? (
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Nome</label>
                    <input type="text" value={nome} onChange={(e) => setNome(e.target.value)} className="input-field" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>WhatsApp</label>
                    <input type="tel" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} className="input-field" placeholder="(47) 99999-9999" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => setEditando(false)} className="btn-secondary flex-1 text-sm py-2">Cancelar</button>
                    <button onClick={salvarPerfil} disabled={salvando} className="btn-primary flex-1 text-sm py-2">
                      {salvando ? "Salvando..." : "Salvar"}
                    </button>
                  </div>
                </div>
              ) : (
                <button onClick={() => setEditando(true)} className="text-sm font-medium" style={{ color: "var(--vovo-rosa)" }}>
                  ✏️ Editar perfil
                </button>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>Plano atual</h3>
              {usuario.tipo_usuario === "aluna_leandro" ? (
                <div className="flex items-center gap-2">
                  <span className="text-xl">🏋️</span>
                  <p className="text-sm font-medium" style={{ color: "var(--vovo-verde)" }}>
                    Aluna do Personal Leandro — acesso premium completo
                  </p>
                </div>
              ) : usuario.tipo_usuario === "premium" ? (
                <div className="space-y-3">
                  <p className="text-sm" style={{ color: "var(--vovo-verde)" }}>
                    ✅ Assinatura {planoAtualLabel} ativa
                  </p>
                  <div className="flex gap-2 flex-wrap">
                    <button
                      onClick={pausarAssinatura}
                      disabled={pausando}
                      className="text-xs font-medium px-3 py-2 rounded-xl border"
                      style={{ borderColor: "var(--vovo-laranja)", color: "var(--vovo-laranja)" }}
                    >
                      {pausando ? "Pausando..." : "⏸ Pausar assinatura"}
                    </button>
                    {confirmaCancelar ? (
                      <div className="flex gap-2">
                        <button
                          onClick={() => setConfirmaCancelar(false)}
                          className="text-xs font-medium px-3 py-2 rounded-xl border"
                          style={{ borderColor: "#d1c8be", color: "var(--vovo-lock)" }}
                        >
                          Voltar
                        </button>
                        <button
                          onClick={cancelarAssinatura}
                          disabled={cancelando}
                          className="text-xs font-medium px-3 py-2 rounded-xl"
                          style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}
                        >
                          {cancelando ? "Cancelando..." : "Confirmar cancelamento"}
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={cancelarAssinatura}
                        className="text-xs font-medium px-3 py-2 rounded-xl border"
                        style={{ borderColor: "#fca5a5", color: "#dc2626" }}
                      >
                        ✕ Cancelar assinatura
                      </button>
                    )}
                  </div>
                </div>
              ) : usuario.trial_fim && new Date(usuario.trial_fim) > new Date() ? (
                <div>
                  <p className="text-sm mb-1" style={{ color: "var(--vovo-laranja)" }}>
                    ⏰ Trial ativo — expira em {Math.ceil((new Date(usuario.trial_fim).getTime() - Date.now()) / 86400000)} dia(s)
                  </p>
                  <Link href="/assinar" className="text-xs font-medium" style={{ color: "var(--vovo-rosa)" }}>
                    Assinar antes que expire →
                  </Link>
                </div>
              ) : (
                <div>
                  <p className="text-sm mb-3" style={{ color: "var(--vovo-marrom-mid)" }}>
                    Sem assinatura ativa — assine para ter acesso às receitas.
                  </p>
                  <Link href="/assinar" className="btn-primary text-sm py-2">
                    {!usuario.trial_inicio ? "Experimentar 7 dias grátis 🎁" : "Ver planos premium 💕"}
                  </Link>
                </div>
              )}
            </div>

            <div className="card">
              <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>Segurança</h3>
              <Link href="/alterar-senha" className="text-sm font-medium" style={{ color: "var(--vovo-rosa)" }}>
                🔐 Alterar senha
              </Link>
            </div>

            <div className="card">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="font-semibold text-sm" style={{ color: "var(--vovo-marrom)" }}>
                    🔔 Notificações da Vovó
                  </h3>
                  <p className="text-xs mt-0.5" style={{ color: "var(--vovo-marrom-mid)" }}>
                    Receba novas receitinhas toda semana!
                  </p>
                </div>
                <button
                  onClick={togglePush}
                  disabled={togglendoPush}
                  className="relative w-12 h-6 rounded-full transition-colors flex-shrink-0"
                  style={{ backgroundColor: pushAtivo ? "var(--vovo-verde)" : "#d1c8be" }}
                >
                  <span
                    className="absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform"
                    style={{ transform: pushAtivo ? "translateX(24px)" : "translateX(2px)" }}
                  />
                </button>
              </div>
            </div>

            {(usuario.tipo_usuario === "premium" || usuario.tipo_usuario === "aluna_leandro") && (
              <Link href="/renda-extra" className="card block">
                <div className="flex items-center gap-3">
                  <span className="text-2xl">💰</span>
                  <div>
                    <p className="font-semibold text-sm" style={{ color: "var(--vovo-marrom)" }}>Programa de Afiliados</p>
                    <p className="text-xs" style={{ color: "var(--vovo-marrom-mid)" }}>Ganhe indicando o app para outras pessoas</p>
                  </div>
                  <span className="ml-auto" style={{ color: "var(--vovo-lock)" }}>→</span>
                </div>
              </Link>
            )}

            {usuario.tipo_usuario === "admin" && (
              <Link
                href="/admin"
                className="block w-full py-3 rounded-xl text-sm font-medium text-center mb-2"
                style={{ backgroundColor: "#5C3D2E", color: "white" }}
              >
                ⚙️ Painel Admin
              </Link>
            )}

            <button
              onClick={logout}
              className="w-full py-3 rounded-xl text-sm font-medium"
              style={{ color: "var(--vovo-rosa)", backgroundColor: "white", border: "1.5px solid #e5e0da" }}
            >
              Sair da conta
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
