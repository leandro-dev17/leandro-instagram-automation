"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Aluna = {
  id: number;
  email: string;
  nome: string | null;
  sexo: "M" | "F" | null;
  ativo: boolean;
  created_at: string;
  last_access_at: string | null;
  usuario_id: number | null;
  tipo_usuario: string | null;
  total_favoritos: number;
};

export default function AdminAlunasPage() {
  const [alunas, setAlunas] = useState<Aluna[]>([]);
  const [novoEmail, setNovoEmail] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [novaSenha, setNovaSenha] = useState("");
  const [novoSexo, setNovoSexo] = useState<"F" | "M">("F");
  const [carregando, setCarregando] = useState(true);
  const [adicionando, setAdicionando] = useState(false);
  const [erroForm, setErroForm] = useState("");

  function carregar() {
    setCarregando(true);
    fetch("/api/admin/alunas")
      .then((r) => r.json())
      .then((data) => {
        setAlunas(data.dados || []);
        setCarregando(false);
      })
      .catch(() => setCarregando(false));
  }

  useEffect(() => { carregar(); }, []);

  async function adicionar(e: React.FormEvent) {
    e.preventDefault();
    setErroForm("");
    setAdicionando(true);
    const res = await fetch("/api/admin/alunas", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: novoEmail, nome: novoNome, senha: novaSenha, sexo: novoSexo }),
    });
    const data = await res.json();
    if (!res.ok) {
      setErroForm(data.erro || "Erro ao adicionar");
      setAdicionando(false);
      return;
    }
    setNovoEmail("");
    setNovoNome("");
    setNovaSenha("");
    setNovoSexo("F");
    setAdicionando(false);
    carregar();
  }

  async function toggleAtivo(aluna: Aluna) {
    await fetch(`/api/admin/alunas/${aluna.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ativo: !aluna.ativo }),
    });
    carregar();
  }

  async function excluir(id: number) {
    if (!confirm("Remover esta aluna?")) return;
    await fetch(`/api/admin/alunas/${id}`, { method: "DELETE" });
    carregar();
  }

  return (
    <div className="min-h-screen" style={{ backgroundColor: "var(--vovo-creme)" }}>
      <header className="px-4 py-3 flex items-center gap-3 shadow-sm" style={{ backgroundColor: "var(--vovo-marrom)" }}>
        <Link href="/admin" className="text-white text-lg">←</Link>
        <span className="text-white font-bold">Alunas do Personal</span>
      </header>

      <div className="px-4 pt-4 max-w-3xl mx-auto">
        <div className="card mb-4">
          <h3 className="font-semibold mb-3" style={{ color: "var(--vovo-marrom)" }}>Adicionar aluna</h3>
          <form onSubmit={adicionar} className="space-y-2">
            <input type="text" value={novoNome} onChange={(e) => setNovoNome(e.target.value)} className="input-field" placeholder="Nome (opcional)" />
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setNovoSexo("F")}
                className="flex-1 py-2 rounded text-sm font-semibold border transition-all"
                style={{
                  backgroundColor: novoSexo === "F" ? "var(--vovo-marrom)" : "transparent",
                  color: novoSexo === "F" ? "white" : "var(--vovo-marrom)",
                  borderColor: "var(--vovo-marrom)",
                }}
              >
                🌸 Aluna (F)
              </button>
              <button
                type="button"
                onClick={() => setNovoSexo("M")}
                className="flex-1 py-2 rounded text-sm font-semibold border transition-all"
                style={{
                  backgroundColor: novoSexo === "M" ? "var(--vovo-marrom)" : "transparent",
                  color: novoSexo === "M" ? "white" : "var(--vovo-marrom)",
                  borderColor: "var(--vovo-marrom)",
                }}
              >
                💪 Aluno (M)
              </button>
            </div>
            <input type="email" value={novoEmail} onChange={(e) => setNovoEmail(e.target.value)} className="input-field" placeholder="email@exemplo.com" required />
            <input type="text" value={novaSenha} onChange={(e) => setNovaSenha(e.target.value)} className="input-field" placeholder="Senha temporária (mín. 6 caracteres)" required />
            {erroForm && <p className="text-xs text-red-600">{erroForm}</p>}
            <button type="submit" disabled={adicionando} className="btn-primary w-full">
              {adicionando ? "Adicionando..." : "+ Adicionar aluna"}
            </button>
          </form>
          <p className="text-xs mt-2" style={{ color: "var(--vovo-lock)" }}>
            💡 A aluna acessa com o email e senha temporária que você definir aqui.
          </p>
        </div>

        {carregando ? (
          <div className="text-center py-12"><div className="text-4xl animate-bounce">💪</div></div>
        ) : (
          <div className="space-y-2">
            {alunas.map((a) => (
              <div key={a.id} className="card p-3 flex items-center gap-3">
                <div
                  className="w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0"
                  style={{ backgroundColor: a.ativo ? "var(--vovo-verde)" : "var(--vovo-lock)" }}
                >
                  {a.ativo ? "✓" : "✕"}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-sm" style={{ color: "var(--vovo-marrom)" }}>
                    {a.sexo === "M" ? "💪" : "🌸"} {a.nome || "Sem nome"}
                  </p>
                  <p className="text-xs truncate" style={{ color: "var(--vovo-marrom-mid)" }}>{a.email}</p>
                  <p className="text-xs mt-0.5" style={{ color: a.usuario_id ? "var(--vovo-verde)" : "#e67e22" }}>
                    {a.usuario_id ? "✓ Conta criada" : "⚠ Sem conta de acesso"}
                  </p>
                  <div className="flex gap-3 mt-0.5">
                    <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>
                      ❤️ {a.total_favoritos} favoritas
                    </p>
                    <p className="text-xs" style={{ color: "var(--vovo-lock)" }}>
                      {a.last_access_at
                        ? `📅 ${new Date(a.last_access_at).toLocaleDateString("pt-BR")}`
                        : "📅 Nunca acessou"}
                    </p>
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => toggleAtivo(a)}
                    className="text-xs px-2 py-1 rounded"
                    style={{
                      backgroundColor: a.ativo ? "#fee2e2" : "#dcfce7",
                      color: a.ativo ? "#dc2626" : "#16a34a",
                    }}
                  >
                    {a.ativo ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    onClick={() => excluir(a.id)}
                    className="text-xs px-2 py-1 rounded"
                    style={{ backgroundColor: "#f3f4f6", color: "#6b7280" }}
                  >
                    🗑
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
