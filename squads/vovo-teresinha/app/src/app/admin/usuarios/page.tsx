"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Usuario = {
  id: number;
  nome: string;
  email: string;
  whatsapp: string | null;
  tipo_usuario: string;
  plano: string | null;
  trial_fim: string | null;
  last_login: string | null;
  favoritos_count: number;
};

function formatarUltimoAcesso(last_login: string | null): { texto: string; cor: string } {
  if (!last_login) return { texto: "nunca acessou", cor: "#dc2626" };

  const dias = Math.floor((Date.now() - new Date(last_login).getTime()) / (1000 * 60 * 60 * 24));

  if (dias <= 0) return { texto: "acessou hoje", cor: "#16a34a" };
  if (dias === 1) return { texto: "há 1 dia", cor: "#16a34a" };
  if (dias <= 6) return { texto: `há ${dias} dias`, cor: "#92400e" };
  if (dias <= 14) return { texto: `há ${dias} dias`, cor: "#ea580c" };
  return { texto: `há ${dias} dias`, cor: "#dc2626" };
}

const TIPOS = ["free", "premium", "aluna_leandro", "admin"];

const TIPO_COR: Record<string, string> = {
  admin: "#7c3aed",
  premium: "#16a34a",
  aluna_leandro: "#0284c7",
  free: "#92400e",
};

export default function AdminUsuariosPage() {
  const [usuarios, setUsuarios] = useState<Usuario[]>([]);
  const [busca, setBusca] = useState("");
  const [tipo, setTipo] = useState("");
  const [carregando, setCarregando] = useState(true);
  const [editando, setEditando] = useState<Usuario | null>(null);
  const [salvando, setSalvando] = useState(false);
  const [excluindo, setExcluindo] = useState(false);
  const [confirmaExcluir, setConfirmaExcluir] = useState(false);
  const [form, setForm] = useState({ nome: "", email: "", tipo_usuario: "", plano: "", trial_fim: "" });

  function carregar() {
    setCarregando(true);
    const params = new URLSearchParams();
    if (busca) params.set("busca", busca);
    if (tipo) params.set("tipo", tipo);
    fetch(`/api/admin/usuarios?${params}`)
      .then((r) => r.json())
      .then((data) => { setUsuarios(data.dados || []); setCarregando(false); })
      .catch(() => setCarregando(false));
  }

  useEffect(() => { carregar(); }, []);

  function abrirEdicao(u: Usuario) {
    setConfirmaExcluir(false);
    setEditando(u);
    setForm({
      nome: u.nome,
      email: u.email,
      tipo_usuario: u.tipo_usuario,
      plano: u.plano || "",
      trial_fim: u.trial_fim ? u.trial_fim.slice(0, 10) : "",
    });
  }

  async function salvar() {
    if (!editando) return;
    setSalvando(true);
    const res = await fetch(`/api/admin/usuarios/${editando.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        nome: form.nome,
        email: form.email,
        tipo_usuario: form.tipo_usuario,
        plano: form.plano || null,
        trial_fim: form.trial_fim || null,
      }),
    });
    if (res.ok) { setEditando(null); carregar(); }
    setSalvando(false);
  }

  async function excluirUsuario() {
    if (!editando) return;
    setExcluindo(true);
    const res = await fetch(`/api/admin/usuarios/${editando.id}`, { method: "DELETE" });
    setExcluindo(false);
    if (res.ok) { setEditando(null); setConfirmaExcluir(false); carregar(); }
  }

  async function cancelarAssinatura(id: number) {
    if (!confirm("Cancelar assinatura deste usuário?")) return;
    await fetch(`/api/admin/usuarios/${id}/cancelar`, { method: "POST" });
    carregar();
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center gap-3 shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <Link href="/admin" className="text-white text-lg">←</Link>
        <span className="text-white font-bold">👥 Usuários</span>
        <span className="text-white text-xs opacity-60 ml-auto">{usuarios.length} encontrados</span>
      </header>

      <div className="px-4 pt-4 max-w-3xl mx-auto">
        <div className="flex gap-2 mb-4">
          <input
            type="search"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && carregar()}
            placeholder="Buscar por nome ou email..."
            className="input-field flex-1"
          />
          <select value={tipo} onChange={(e) => setTipo(e.target.value)} className="input-field w-32">
            <option value="">Todos</option>
            {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <button onClick={carregar} className="btn-primary px-4">🔍</button>
        </div>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">👥</div></div>
        ) : usuarios.length === 0 ? (
          <div className="text-center py-12">
            <div className="text-4xl mb-2">👥</div>
            <p className="text-sm mb-3" style={{ color: "var(--vovo-lock)" }}>Nenhum usuário encontrado</p>
            <button onClick={carregar} className="btn-primary text-sm">Recarregar</button>
          </div>
        ) : (
          <div className="space-y-2">
            {usuarios.map((u) => (
              <div key={u.id} className="card p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm" style={{ color: "var(--vovo-marrom)" }}>{u.nome}</p>
                    <p className="text-xs" style={{ color: "var(--vovo-marrom-mid)" }}>{u.email}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{ backgroundColor: `${TIPO_COR[u.tipo_usuario]}20`, color: TIPO_COR[u.tipo_usuario] }}
                      >
                        {u.tipo_usuario}
                      </span>
                      {u.plano && <span className="text-xs" style={{ color: "var(--vovo-lock)" }}>{u.plano}</span>}
                      {u.trial_fim && new Date(u.trial_fim) > new Date() && (
                        <span className="text-xs" style={{ color: "var(--vovo-laranja)" }}>
                          trial até {new Date(u.trial_fim).toLocaleDateString("pt-BR")}
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span
                        className="text-xs px-2 py-0.5 rounded-full font-medium"
                        style={{
                          backgroundColor: `${formatarUltimoAcesso(u.last_login).cor}20`,
                          color: formatarUltimoAcesso(u.last_login).cor,
                        }}
                      >
                        🕒 {formatarUltimoAcesso(u.last_login).texto}
                      </span>
                      <span className="text-xs" style={{ color: "var(--vovo-lock)" }}>
                        🍲 {u.favoritos_count} {u.favoritos_count === 1 ? "receita salva" : "receitas salvas"}
                      </span>
                    </div>
                  </div>
                  <div className="flex gap-1 flex-shrink-0">
                    <button
                      onClick={() => abrirEdicao(u)}
                      className="text-xs px-2 py-1 rounded-lg"
                      style={{ backgroundColor: "#eff6ff", color: "#2563eb" }}
                    >
                      ✏️ Editar
                    </button>
                    {u.tipo_usuario === "premium" && (
                      <button
                        onClick={() => cancelarAssinatura(u.id)}
                        className="text-xs px-2 py-1 rounded-lg"
                        style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}
                      >
                        Cancelar
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Modal de edição */}
      {editando && (
        <div className="fixed inset-0 z-50 bg-black bg-opacity-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md p-5 shadow-xl">
            <div className="flex items-center justify-between mb-4">
              <h2 className="font-bold" style={{ color: "var(--vovo-marrom)" }}>✏️ Editar usuário</h2>
              <button onClick={() => setEditando(null)} className="text-lg" style={{ color: "var(--vovo-lock)" }}>✕</button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Nome</label>
                <input type="text" value={form.nome} onChange={(e) => setForm(f => ({ ...f, nome: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Email</label>
                <input type="email" value={form.email} onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))} className="input-field" />
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Tipo de usuário</label>
                <select value={form.tipo_usuario} onChange={(e) => setForm(f => ({ ...f, tipo_usuario: e.target.value }))} className="input-field">
                  {TIPOS.map((t) => <option key={t} value={t}>{t}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Plano</label>
                <select value={form.plano} onChange={(e) => setForm(f => ({ ...f, plano: e.target.value }))} className="input-field">
                  <option value="">Nenhum</option>
                  <option value="mensal">Mensal</option>
                  <option value="anual">Anual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: "var(--vovo-marrom)" }}>Trial até (opcional)</label>
                <input type="date" value={form.trial_fim} onChange={(e) => setForm(f => ({ ...f, trial_fim: e.target.value }))} className="input-field" />
              </div>
            </div>

            <div className="flex gap-2 mt-4">
              <button onClick={() => setEditando(null)} className="btn-secondary flex-1 text-sm">Cancelar</button>
              <button onClick={salvar} disabled={salvando} className="btn-primary flex-1 text-sm">
                {salvando ? "Salvando..." : "Salvar alterações"}
              </button>
            </div>

            <div className="mt-3 pt-3 border-t" style={{ borderColor: "#f0ebe5" }}>
              {!confirmaExcluir ? (
                <button
                  onClick={() => setConfirmaExcluir(true)}
                  className="w-full py-2 rounded-xl text-xs font-medium"
                  style={{ backgroundColor: "#fee2e2", color: "#dc2626" }}
                >
                  🗑️ Excluir usuário
                </button>
              ) : (
                <div className="space-y-2">
                  <p className="text-xs text-center font-medium" style={{ color: "#dc2626" }}>
                    Tem certeza? Esta ação não pode ser desfeita.
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setConfirmaExcluir(false)}
                      className="btn-secondary flex-1 text-xs py-2"
                    >
                      Voltar
                    </button>
                    <button
                      onClick={excluirUsuario}
                      disabled={excluindo}
                      className="flex-1 py-2 rounded-xl text-xs font-medium"
                      style={{ backgroundColor: "#dc2626", color: "white" }}
                    >
                      {excluindo ? "Excluindo..." : "Confirmar exclusão"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
