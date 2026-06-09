"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

export default function AlterarSenhaPage() {
  const router = useRouter();
  const [form, setForm] = useState({ senha_atual: "", nova_senha: "", confirmar: "" });
  const [erro, setErro] = useState("");
  const [sucesso, setSucesso] = useState(false);
  const [carregando, setCarregando] = useState(false);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((f) => ({ ...f, [e.target.name]: e.target.value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErro("");

    if (form.nova_senha.length < 8) {
      setErro("Nova senha deve ter ao menos 8 caracteres");
      return;
    }

    if (form.nova_senha !== form.confirmar) {
      setErro("As senhas não coincidem");
      return;
    }

    setCarregando(true);
    try {
      const res = await fetch("/api/usuarios/senha", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ senha_atual: form.senha_atual, nova_senha: form.nova_senha }),
      });

      const data = await res.json();

      if (!res.ok) {
        setErro(data.erro || "Erro ao alterar senha");
        return;
      }

      setSucesso(true);
      setTimeout(() => router.push("/perfil"), 2000);
    } catch {
      setErro("Erro de conexão");
    } finally {
      setCarregando(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4" style={{ background: "var(--vovo-creme)" }}>
      <div className="w-full max-w-sm">
        <Link href="/perfil" className="text-sm mb-6 block" style={{ color: "var(--vovo-rosa)" }}>
          ← Voltar ao perfil
        </Link>

        <h1 className="text-2xl font-bold mb-6" style={{ color: "var(--vovo-marrom)" }}>
          🔐 Alterar senha
        </h1>

        {sucesso ? (
          <div className="card text-center">
            <p className="text-2xl mb-2">✅</p>
            <p className="font-semibold" style={{ color: "var(--vovo-verde)" }}>
              Senha alterada com sucesso!
            </p>
            <p className="text-sm text-gray-500 mt-1">Redirecionando...</p>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="card space-y-4">
            {erro && (
              <p className="text-sm text-red-600 bg-red-50 p-3 rounded-lg">{erro}</p>
            )}
            <div>
              <label className="text-sm font-medium block mb-1" style={{ color: "var(--vovo-marrom)" }}>
                Senha atual
              </label>
              <input
                type="password"
                name="senha_atual"
                value={form.senha_atual}
                onChange={handleChange}
                required
                className="input-field"
                placeholder="••••••••"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1" style={{ color: "var(--vovo-marrom)" }}>
                Nova senha
              </label>
              <input
                type="password"
                name="nova_senha"
                value={form.nova_senha}
                onChange={handleChange}
                required
                minLength={6}
                className="input-field"
                placeholder="Mínimo 6 caracteres"
              />
            </div>
            <div>
              <label className="text-sm font-medium block mb-1" style={{ color: "var(--vovo-marrom)" }}>
                Confirmar nova senha
              </label>
              <input
                type="password"
                name="confirmar"
                value={form.confirmar}
                onChange={handleChange}
                required
                className="input-field"
                placeholder="Repita a nova senha"
              />
            </div>
            <button
              type="submit"
              disabled={carregando}
              className="btn-primary w-full"
            >
              {carregando ? "Salvando..." : "Alterar senha"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
